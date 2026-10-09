#!/usr/bin/env node
// Container/fast-path audit only: no image decoding and no per-file report data.
import { constants } from 'node:fs'
import { lstat, open, opendir } from 'node:fs/promises'
import { resolve, parse, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { build } from 'esbuild'

export async function loadGate() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/independent-frame.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    write: false
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}
const tag = (b) => b.toString('latin1', 0, 4)
const u24 = (b, p) => b.readUIntLE(p, 3)
const fail = (reason) => Object.assign(new Error(reason), { auditReason: reason })
const increment = (map, key) => {
  map[key] = (map[key] ?? 0) + 1
}
const summary = () => ({ count: 0, sum: 0, min: null, max: null })
const add = (s, n) => {
  s.count++
  s.sum += n
  s.min = Math.min(s.min ?? n, n)
  s.max = Math.max(s.max ?? n, n)
}
const positionBucket = (n) => (n <= 1 ? '1' : n <= 10 ? '2-10' : n <= 100 ? '11-100' : n <= 300 ? '101-300' : '301+')

// Check ancestors as well as the final name; explicit paths must not traverse symlinks.
async function noSymlinks(path) {
  const absolute = resolve(path)
  let current = parse(absolute).root
  for (const part of absolute.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part)
    if ((await lstat(current)).isSymbolicLink()) throw fail('symlink')
  }
  return absolute
}

export async function inspectFile(path, gate, options = {}) {
  const { signal, rateMiB = 8, maxBytes = 256 * 1024 * 1024 } = options
  path = await noSymlinks(path)
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let readBytes = 0
  const start = performance.now()
  const check = () => {
    if (signal?.aborted) throw fail('interrupted')
  }
  const read = async (count) => {
    check()
    const out = Buffer.alloc(count)
    let done = 0
    while (done < count) {
      check()
      const size = Math.min(65536, count - done)
      const { bytesRead } = await fd.read(out, done, size, null)
      if (!bytesRead) throw fail('truncated')
      done += bytesRead
      readBytes += bytesRead
      if (rateMiB > 0) {
        let wait
        while ((wait = (readBytes / (rateMiB * 1024 * 1024)) * 1000 - (performance.now() - start)) > 0) {
          check()
          await new Promise((r) => setTimeout(r, Math.min(wait, 100)))
        }
      }
    }
    return out
  }
  const discard = async (count) => {
    while (count > 0) {
      const n = Math.min(count, 65536)
      await read(n)
      count -= n
    }
  }
  try {
    const before = await fd.stat()
    if (!before.isFile()) throw fail('not-file')
    if (before.size > maxBytes) throw fail('size-limit')
    if (before.size < 12) throw fail('truncated')
    const riff = await read(12)
    if (tag(riff) !== 'RIFF' || tag(riff.subarray(8)) !== 'WEBP') throw fail('not-webp')
    if (riff.readUInt32LE(4) + 8 !== before.size) throw fail('riff-size-mismatch')
    let offset = 12,
      prefix = riff,
      header = null,
      reason = null,
      firstFailureFrame = null
    let frames = 0,
      durationMs = 0,
      width = null,
      height = null,
      animationFlag = false,
      animCount = 0,
      unknownChunks = 0
    const reject = (r) => {
      if (!reason) {
        reason = r
        firstFailureFrame = frames + 1
      }
    }
    while (offset < before.size) {
      if (before.size - offset < 8) throw fail('truncated-chunk-header')
      const chunk = await read(8),
        size = chunk.readUInt32LE(4),
        padded = size + (size % 2),
        kind = tag(chunk)
      if (padded > before.size - offset - 8) throw fail('chunk-out-of-bounds')
      const classification = gate.independentChunkKind(chunk)
      if (
        classification === 'invalid' &&
        !(offset === 12 && kind === 'VP8X') &&
        (animationFlag || animCount || kind === 'VP8X')
      )
        throw fail('invalid-top-level-chunk')
      let body
      if (size <= gate.FRAME_LIMIT) body = await read(size)
      else {
        body = await read(Math.min(size, 34))
        await discard(size - body.length)
      }
      if (size % 2 && (await read(1))[0] !== 0) throw fail('nonzero-padding')
      if (offset < 44)
        prefix = Buffer.concat([prefix, chunk, body.subarray(0, Math.max(0, 44 - offset - 8))]).subarray(0, 44)
      if (offset === 12 && kind === 'VP8X' && size === 10) {
        width = u24(body, 4) + 1
        height = u24(body, 7) + 1
        animationFlag = !!(body[0] & 2)
      }
      if (kind === 'ANIM') {
        if (padded < 6) throw fail('invalid-anim')
        animCount++
      }
      if (offset === 30 && offset + 8 + padded === 44) header = gate.independentHeader(prefix)
      if (offset >= 44 || kind === 'ANMF') {
        if (classification === 'frame') {
          if (!animCount) throw fail('missing-anim')
          if (size < 16) throw fail('invalid-anmf')
          const raw = u24(body, 12)
          durationMs += raw <= 10 ? 100 : raw
          if (!header) reject('header-layout-or-flags')
          else if (padded > gate.FRAME_LIMIT) reject('frame-size-budget')
          else if (!gate.independentFrame(header, chunk, size % 2 ? Buffer.concat([body, Buffer.alloc(1)]) : body)) {
            reject(
              u24(body, 0) || u24(body, 3) || u24(body, 6) + 1 !== header.width || u24(body, 9) + 1 !== header.height
                ? 'partial-frame'
                : body[15] !== 0 && body[15] !== 2
                  ? 'dispose-or-reserved-flags'
                  : tag(body.subarray(16)) !== 'VP8 '
                    ? 'non-opaque-vp8-layout'
                    : 'vp8-layout-or-dimensions'
            )
          }
          frames++
        } else if (classification === 'unknown') unknownChunks++
      }
      offset += 8 + padded
    }
    const after = await fd.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw fail('file-changed')
    if (!animationFlag && frames === 0 && animCount === 0) return { classification: 'static' }
    if (!animationFlag || animCount < 1 || !frames) throw fail('invalid-animation-container')
    return {
      classification: reason ? (firstFailureFrame <= 1 ? 'initial-fallback' : 'midstream-fallback') : 'whole-fast-path',
      reason,
      firstFailureFrame,
      frames,
      durationMs,
      width,
      height,
      bytes: before.size,
      unknownChunks
    }
  } finally {
    await fd.close()
  }
}

export async function scan(paths, options = {}) {
  const gate = options.gate ?? (await loadGate())
  const limit = options.limit ?? 100
  const report = {
    schemaVersion: 1,
    gateVersion: 'opaque-vp8-flags-0-or-2-v1',
    scope: 'container-and-current-fast-path-gate-not-decode-validity-or-realtime-coverage',
    selection: 'filesystem-order-first-N-not-random',
    limits: {
      files: limit,
      maxBytesPerFile: options.maxBytes ?? 256 * 1024 * 1024,
      rateMiBPerSecond: options.rateMiB ?? 8,
      maxDirectoryDepth: 64,
      entries: options.maxEntries ?? 10000
    },
    visitedEntries: 0,
    entryLimitReached: false,
    interrupted: false,
    limitReached: false,
    visitedWebpFiles: 0,
    classifications: {},
    reasons: {},
    fallbackFrameBuckets: {},
    errors: {},
    skippedSymlinks: 0,
    animation: {
      bytes: summary(),
      width: summary(),
      height: summary(),
      frames: summary(),
      normalizedDurationMs: summary()
    },
    unknownChunks: 0
  }
  const seen = new Set() // Deduplicate only the bounded sample, not the entire directory tree.
  async function visit(path, depth = 0) {
    if (options.signal?.aborted) {
      report.interrupted = true
      return
    }
    if (report.visitedEntries >= report.limits.entries) {
      report.entryLimitReached = true
      return
    }
    report.visitedEntries++
    if (report.visitedWebpFiles >= limit) {
      report.limitReached = true
      return
    }
    try {
      const stat = await lstat(path)
      if (stat.isSymbolicLink()) {
        report.skippedSymlinks++
        return
      }
      if (stat.isDirectory()) {
        if (depth >= 64) {
          increment(report.errors, 'directory-depth-limit')
          return
        }
        const dir = await opendir(path)
        for await (const entry of dir) {
          await visit(join(path, entry.name), depth + 1)
          if (report.interrupted || report.limitReached || report.entryLimitReached) break
        }
      } else if (stat.isFile() && /\.webp$/i.test(path)) {
        const identity = `${stat.dev}:${stat.ino}`
        if (seen.has(identity)) return
        seen.add(identity)
        report.visitedWebpFiles++
        try {
          const result = await inspectFile(path, gate, options)
          increment(report.classifications, result.classification)
          if (result.classification !== 'static') {
            for (const [key, value] of Object.entries({
              bytes: result.bytes,
              width: result.width,
              height: result.height,
              frames: result.frames,
              normalizedDurationMs: result.durationMs
            }))
              if (value !== null) add(report.animation[key], value)
            report.unknownChunks += result.unknownChunks
            if (result.reason) {
              increment(report.reasons, result.reason)
              increment(report.fallbackFrameBuckets, positionBucket(result.firstFailureFrame))
            }
          }
        } catch (error) {
          if (error.auditReason === 'interrupted') report.interrupted = true
          else increment(report.errors, error.auditReason ?? 'read-failed')
        }
      }
    } catch (error) {
      increment(report.errors, error.auditReason ?? 'path-unavailable')
    }
  }
  for (const path of paths) {
    try {
      await visit(await noSymlinks(path))
    } catch (error) {
      increment(report.errors, error.auditReason ?? 'path-unavailable')
    }
    if (report.interrupted || report.limitReached || report.entryLimitReached) break
  }
  report.partial =
    report.interrupted || report.limitReached || report.entryLimitReached || Object.keys(report.errors).length > 0
  const denominator = report.animation.frames.count
  report.wholeFastPathFractionOfContainerParsedAnimations = denominator
    ? (report.classifications['whole-fast-path'] ?? 0) / denominator
    : null
  return report
}

async function main() {
  const args = process.argv.slice(2),
    paths = [],
    options = {}
  const names = {
    '--limit': 'limit',
    '--rate-mib': 'rateMiB',
    '--max-file-mib': 'maxBytes',
    '--max-entries': 'maxEntries'
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help') {
      console.log(
        'node scripts/scan-coverage.mjs --path FILE_OR_DIRECTORY [--path ...] [--limit 100] [--max-entries 10000] [--rate-mib 8] [--max-file-mib 256]\nJSON aggregates go to stdout; Ctrl-C emits a partial report. No decode or media writes.'
      )
      return
    }
    if (arg === '--path' && args[i + 1]) paths.push(args[++i])
    else if (names[arg]) {
      const value = Number(args[++i])
      if (
        !Number.isFinite(value) ||
        value <= 0 ||
        (['--limit', '--max-entries'].includes(arg) && (!Number.isInteger(value) || value > 1000000)) ||
        (arg === '--max-file-mib' && value > 4096)
      )
        throw fail('invalid-option')
      options[names[arg]] = arg === '--max-file-mib' ? value * 1024 * 1024 : value
    } else throw fail('invalid-option')
  }
  if (!paths.length) throw fail('explicit-path-required')
  const controller = new AbortController(),
    stop = () => controller.abort()
  process.on('SIGINT', stop)
  try {
    console.log(JSON.stringify(await scan(paths, { ...options, signal: controller.signal }), null, 2))
  } finally {
    process.off('SIGINT', stop)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => {
    console.error('Coverage scan failed: check arguments and tool availability (--help).')
    process.exitCode = 1
  })
