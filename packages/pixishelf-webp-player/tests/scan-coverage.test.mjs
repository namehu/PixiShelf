import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { inspectFile, loadGate, scan } from '../scripts/scan-coverage.mjs'
const gate = await loadGate()
const original = await readFile(new URL('./fixtures/independent.webp', import.meta.url))
const chunk = (name, data = Buffer.from([1])) => {
  const out = Buffer.alloc(8 + data.length + (data.length % 2))
  out.write(name)
  out.writeUInt32LE(data.length, 4)
  data.copy(out, 8)
  return out
}
const insert = (at, bytes) => {
  const out = Buffer.concat([original.subarray(0, at), bytes, original.subarray(at)])
  out.writeUInt32LE(out.length - 8, 4)
  return out
}
async function fixture(t, bytes = original) {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'webp-coverage-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'private-title.webp')
  await writeFile(path, bytes)
  return { dir, path }
}
test('uses production gate and aggregates without private filenames or unbounded records', async (t) => {
  const { path } = await fixture(t)
  const result = await scan([path], { gate, rateMiB: 0 })
  assert.equal(result.classifications['whole-fast-path'], 1)
  assert.equal(result.animation.frames.sum, 12)
  assert.equal(result.wholeFastPathFractionOfContainerParsedAnimations, 1)
  assert.doesNotMatch(JSON.stringify(result), /private-title|webp-coverage-|\/tmp\//)
})
test('unknown, undeclared metadata and valid repeated ANIM remain eligible', async (t) => {
  for (const at of [44, original.length]) {
    for (const data of [
      chunk('ZZZZ'),
      chunk('ICCP'),
      chunk('EXIF'),
      chunk('XMP '),
      ...[5, 6, 7].map((n) => chunk('ANIM', Buffer.alloc(n)))
    ]) {
      const { path } = await fixture(t, insert(at, data))
      assert.equal((await inspectFile(path, gate, { rateMiB: 0 })).classification, 'whole-fast-path')
    }
  }
})
test('invalid animation top-level chunks and short repeated ANIM are rejected', async (t) => {
  for (const at of [30, 44, original.length]) {
    for (const data of [...['ALPH', 'VP8 ', 'VP8L', 'VP8X'].map((n) => chunk(n)), chunk('ANIM', Buffer.alloc(4))]) {
      const { path } = await fixture(t, insert(at, data))
      await assert.rejects(inspectFile(path, gate, { rateMiB: 0 }), /invalid/)
    }
  }
})
test('extended static image chunks are not subject to animation-only rejection', async (t) => {
  const header = Buffer.from(original.subarray(0, 30))
  header[20] = 16
  const bytes = Buffer.concat([header, chunk('EXIF', Buffer.alloc(12)), chunk('ALPH'), chunk('VP8 ', Buffer.alloc(10))])
  bytes.writeUInt32LE(bytes.length - 8, 4)
  const { path } = await fixture(t, bytes)
  assert.equal((await inspectFile(path, gate, { rateMiB: 0 })).classification, 'static')
})
test('distinguishes initial vs late dependent frame and normalizes duration', async (t) => {
  for (const index of [0, 3]) {
    const bytes = Buffer.from(original)
    let offset = 44
    for (let i = 0; i < index; i++) offset += 8 + bytes.readUInt32LE(offset + 4) + (bytes.readUInt32LE(offset + 4) % 2)
    bytes[offset + 8 + 15] = 1
    const { path } = await fixture(t, bytes)
    const r = await inspectFile(path, gate, { rateMiB: 0 })
    assert.equal(r.classification, index ? 'midstream-fallback' : 'initial-fallback')
    assert.equal(r.firstFailureFrame, index + 1)
  }
})
test('rejects truncated, out-of-bounds and nonzero padding', async (t) => {
  const badChunk = insert(original.length, chunk('ZZZZ'))
  badChunk[badChunk.length - 1] = 1
  const bounds = Buffer.from(original)
  bounds.writeUInt32LE(0xffffffff, 48)
  for (const bytes of [original.subarray(0, -1), badChunk, bounds]) {
    const { path } = await fixture(t, bytes)
    await assert.rejects(inspectFile(path, gate, { rateMiB: 0 }))
  }
})
test('limits candidate files and directory entries and supports partial interruption', async (t) => {
  const { dir, path } = await fixture(t)
  await writeFile(join(dir, 'second.webp'), original)
  assert.equal((await scan([dir], { gate, limit: 1, rateMiB: 0 })).visitedWebpFiles, 1)
  assert.equal((await scan([dir], { gate, maxEntries: 1, rateMiB: 0 })).entryLimitReached, true)
  const c = new AbortController()
  c.abort()
  assert.equal((await scan([path], { gate, signal: c.signal })).interrupted, true)
})
test('skips symlinks including ancestors, deduplicates hard identity and enforces byte ceiling', async (t) => {
  const { dir, path } = await fixture(t)
  await symlink(path, join(dir, 'linked.webp'))
  await symlink(dir, join(dir, 'alias'))
  assert.equal((await scan([dir], { gate, rateMiB: 0 })).skippedSymlinks, 2)
  await assert.rejects(inspectFile(join(dir, 'alias', 'private-title.webp'), gate), /symlink/)
  assert.equal((await scan([path, path], { gate, rateMiB: 0 })).visitedWebpFiles, 1)
  assert.equal((await scan([path], { gate, maxBytes: 1 })).errors['size-limit'], 1)
})
test('header incompatibility, static files and oversized frame budgets are separate', async (t) => {
  const badHeader = Buffer.from(original)
  badHeader[20] |= 32
  const a = await fixture(t, badHeader)
  assert.equal((await inspectFile(a.path, gate, { rateMiB: 0 })).reason, 'header-layout-or-flags')
  const still = Buffer.concat([Buffer.from('RIFF\x00\x00\x00\x00WEBP'), chunk('VP8 ', Buffer.alloc(10))])
  still.writeUInt32LE(still.length - 8, 4)
  const b = await fixture(t, still)
  assert.equal((await inspectFile(b.path, gate, { rateMiB: 0 })).classification, 'static')
  const c = await fixture(t, insert(44, chunk('ANMF', Buffer.alloc(gate.FRAME_LIMIT + 1))))
  assert.equal((await inspectFile(c.path, gate, { rateMiB: 0 })).reason, 'frame-size-budget')
})
test('interrupting a rate-limited read produces a partial aggregate instead of raw errors', async (t) => {
  const { path } = await fixture(t)
  const c = new AbortController()
  const timer = setTimeout(() => c.abort(), 20)
  const result = await scan([path], { gate, rateMiB: 0.001, signal: c.signal })
  clearTimeout(timer)
  assert.equal(result.partial, true)
  assert.equal(result.interrupted, true)
  assert.deepEqual(result.errors, {})
})

test('all-frame scanning accepts alternating opaque blend flags, but still rejects disposal and reserved bits', async (t) => {
  const bytes = Buffer.from(original)
  let offset = 44,
    index = 0
  const offsets = []
  while (offset < bytes.length) {
    offsets.push(offset)
    bytes[offset + 23] = index++ % 2 ? 2 : 0
    const size = bytes.readUInt32LE(offset + 4)
    offset += 8 + size + (size % 2)
  }
  const valid = await fixture(t, bytes)
  assert.equal((await inspectFile(valid.path, gate, { rateMiB: 0 })).classification, 'whole-fast-path')
  for (const flags of [1, 3, 4, 6, 128]) {
    const changed = Buffer.from(bytes)
    changed[offsets[7] + 23] = flags
    const invalid = await fixture(t, changed)
    const result = await inspectFile(invalid.path, gate, { rateMiB: 0 })
    assert.equal(result.classification, 'midstream-fallback')
    assert.equal(result.firstFailureFrame, 8)
    assert.equal(result.reason, 'dispose-or-reserved-flags')
  }
})

test('opaque blend does not admit ALPH layouts, including in the portable scanner', async (t) => {
  const bytes = Buffer.from(original)
  bytes[67] = 0
  bytes.write('ALPH', 68)
  const { path, dir } = await fixture(t, bytes)
  const portable = join(dir, 'scan-coverage.mjs')
  execFileSync(process.execPath, [
    fileURLToPath(new URL('../scripts/build-coverage-scanner.mjs', import.meta.url)),
    portable
  ])
  const module = await import(pathToFileURL(portable).href)
  const portableGate = await module.loadGate()
  const cli = JSON.parse(execFileSync(process.execPath, [portable, '--path', path], { encoding: 'utf8' }))
  const imported = await module.scan([path], { gate: portableGate })
  assert.deepEqual(cli, imported)
  assert.equal(cli.reasons['non-opaque-vp8-layout'], 1)
  for (const currentGate of [gate, portableGate]) {
    const result = await inspectFile(path, currentGate, { rateMiB: 0 })
    assert.equal(result.classification, 'initial-fallback')
    assert.equal(result.reason, 'non-opaque-vp8-layout')
    const changed = Buffer.from(original)
    changed[67] = 0
    const valid = await fixture(t, changed)
    assert.equal((await inspectFile(valid.path, currentGate, { rateMiB: 0 })).classification, 'whole-fast-path')
  }
})
