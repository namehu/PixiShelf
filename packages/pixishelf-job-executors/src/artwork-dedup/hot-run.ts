import path from 'node:path'
import {
  readArtworkDedupHotInventoryPage,
  readArtworkDedupHotMembersPage,
  saveArtworkDedupHotRunBatch,
  beginArtworkDedupHotRunReuse,
  copyArtworkDedupHotRunReusePage,
  type ArtworkDedupHotCommit,
  type ArtworkDedupHotInventory,
  type MediaContentMember,
  type ArtworkDedupMediaEntry
} from '@pixishelf/db'
import type { DedupPipelineContext } from './pipeline.ts'
import { MEDIA_CONTENT_ALGORITHM_VERSION } from '../media-content/fingerprint.ts'
import { canonicalMediaContentPath } from '../media-content/roots.ts'
import { sameContentFileState } from '../media-content/file-reader.ts'
import { throwIfAborted } from '../scan/bounded.ts'
import { VISUAL_ALGORITHM_VERSION, VISUAL_NORMALIZATION_VERSION, VISUAL_LIMITS } from './visual-matching.ts'
import { VISUAL_SEARCH_VERSION } from './visual-search-index.ts'

export const HOT_RUN_MEMORY_BUDGET = 1024 * 1024 * 1024
export const HOT_RUN_PRELOAD_LIMIT = 800 * 1024 * 1024
export function hotRunMetadataBytes(value: unknown) {
  // Include UTF-16 strings, objects and Map/array overhead, not just wire JSON size.
  return Buffer.byteLength(JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v))) * 4 + 512
}
const metrics = (metadataBytes = 0) => ({
  statMs: 0,
  fingerprintReuseMs: 0,
  relationReuseMs: 0,
  resultCopyMs: 0,
  hotBatches: 0,
  reusedArtworks: 0,
  reusedRelations: 0,
  copiedRows: 0,
  metadataBytes,
  rssBytes: process.memoryUsage().rss
})

/** Task-scoped immutable metadata; all authority is reacquired by the commit. No original bytes/views are preloaded. */
export async function statArtworkDedupHotRun(
  context: DedupPipelineContext,
  preloadLimit = HOT_RUN_PRELOAD_LIMIT
): Promise<'DONE' | 'YIELD' | 'FALLBACK'> {
  if (context.forceRead || !context.read) return 'FALLBACK'
  const inventory: ArtworkDedupHotInventory[] = [],
    members = new Map<number, MediaContentMember[]>()
  let after = 0,
    metadataBytes = 0
  const memoryFallback = async () => {
    await context.transaction(async (tx) => {
      await context.onHotRunBatch?.(tx, { ...metrics(metadataBytes), metadataFallbacks: 1 })
    })
    return 'FALLBACK' as const
  }
  for (;;) {
    throwIfAborted(context.signal)
    const page = await context.read((tx) => readArtworkDedupHotInventoryPage(tx, context.execution.runId, after))
    if (!page.length) break
    metadataBytes += hotRunMetadataBytes(page)
    if (metadataBytes >= preloadLimit) return memoryFallback()
    inventory.push(...page)
    let imageCursor = 0
    for (;;) {
      throwIfAborted(context.signal)
      const media = await context.read!((tx) =>
        readArtworkDedupHotMembersPage(
          tx,
          page.map((i) => i.item.artworkId),
          imageCursor
        )
      )
      if (!media.length) break
      metadataBytes += hotRunMetadataBytes(media)
      if (metadataBytes >= preloadLimit) return memoryFallback()
      for (const member of media) {
        const group = members.get(member.artworkId) ?? []
        group.push(member)
        members.set(member.artworkId, group)
      }
      imageCursor = media.at(-1)!.imageId
    }
    after = page.at(-1)!.item.artworkId
  }
  let commits: ArtworkDedupHotCommit[] = [],
    count = 0,
    batchStart = performance.now(),
    statMs = 0
  const flush = async () => {
    if (!count) return true
    const delta = metrics(metadataBytes)
    delta.statMs = statMs
    delta.hotBatches = 1
    delta.reusedArtworks = commits.filter((b) => b.complete).length
    const saved = await context.transaction(async (tx) => {
      const start = performance.now()
      if (!(await saveArtworkDedupHotRunBatch(tx, context.execution, commits))) return false
      delta.fingerprintReuseMs = performance.now() - start
      await context.onHotRunBatch?.(tx, delta)
      return true
    })
    commits = []
    count = 0
    statMs = 0
    batchStart = performance.now()
    return saved
  }
  for (const entry of inventory) {
    const art = entry.artwork,
      fingerprint = art?.contentFingerprint,
      allMembers = members.get(entry.item.artworkId) ?? []
    const reusable =
      art &&
      fingerprint &&
      !art.contentSource?.writeToken &&
      fingerprint.algorithmVersion === MEDIA_CONTENT_ALGORITHM_VERSION &&
      fingerprint.sourceRevision === art.contentSource?.revision &&
      fingerprint.mediaEpoch === art.contentSource.mediaEpoch &&
      fingerprint.fileCount > 0n &&
      fingerprint.fileCount === BigInt(allMembers.length)
    if (!reusable) {
      if (!(await flush())) return 'FALLBACK'
      return 'FALLBACK'
    }
    const pending = allMembers.filter((m) => m.imageId > entry.item.afterImageId)
    if (!pending.length) {
      if (!(await flush())) return 'FALLBACK'
      return 'FALLBACK'
    }
    let current: ArtworkDedupHotCommit = { inventory: entry, entries: [], complete: false }
    for (let start = 0; start < pending.length; ) {
      if (
        count === 500 ||
        (commits.length === 50 && !commits.includes(current)) ||
        performance.now() - batchStart >= 1000 ||
        context.shouldYield()
      ) {
        if (!(await flush())) return 'FALLBACK'
        if (context.shouldYield()) return 'YIELD'
        current = {
          inventory:
            start === 0
              ? entry
              : {
                  ...entry,
                  item: {
                    ...entry.item,
                    status: 'STATTING',
                    afterImageId: pending[start - 1]!.imageId,
                    snapshotRevision: fingerprint.sourceRevision,
                    mediaEpoch: fingerprint.mediaEpoch,
                    memberCount: fingerprint.fileCount
                  }
                },
          entries: [],
          complete: false
        }
      }
      const group = pending.slice(start, start + Math.min(4, 500 - count))
      const targets = group.map((member) => {
        const root = art.source === 'URL_ARCHIVE' ? context.roots.archive : context.roots.source
        const sourcePath = canonicalMediaContentPath(member.sourcePath.replace(/^\/+/, ''))
        const relativePath =
          art.source === 'URL_ARCHIVE' && context.roots.archiveRelativePrefix
            ? `${context.roots.archiveRelativePrefix}/${sourcePath}`
            : sourcePath
        const parent = path.posix.dirname(relativePath),
          relativeDirectory = parent === '.' ? '' : parent
        return { member, root, relativePath, relativeDirectory }
      })
      if (
        targets.some(
          ({ member: m, root, relativeDirectory }) =>
            !m.directory ||
            m.writeToken ||
            !m.fingerprint ||
            m.directory.logicalRoot !== root.logicalRoot ||
            m.directory.rootIdentity !== root.rootIdentity ||
            m.directory.relativeDirectory !== relativeDirectory ||
            m.fingerprint.algorithmVersion !== MEDIA_CONTENT_ALGORITHM_VERSION ||
            m.fingerprint.sourceRevision !== m.sourceRevision ||
            m.fingerprint.artworkMediaEpoch !== fingerprint.mediaEpoch ||
            m.fingerprint.sourcePath !== m.sourcePath ||
            m.fingerprint.rootIdentity !== root.rootIdentity
        )
      ) {
        if (!(await flush())) return 'FALLBACK'
        return 'FALLBACK'
      }
      const began = performance.now()
      const inspected = await Promise.allSettled(
        targets.map((t) =>
          context.reader.inspect({ root: t.root, relativePath: t.relativePath, signal: context.signal })
        )
      )
      statMs += performance.now() - began
      throwIfAborted(context.signal)
      // A local file error goes through the existing per-artwork classification path.
      if (inspected.some((r) => r.status === 'rejected')) {
        if (!(await flush())) return 'FALLBACK'
        return 'FALLBACK'
      }
      const entries: ArtworkDedupMediaEntry[] = []
      for (let index = 0; index < targets.length; index++) {
        const t = targets[index]!,
          inspectedFile = inspected[index]!
        if (inspectedFile.status !== 'fulfilled') continue
        const file = inspectedFile.value,
          cached = t.member.fingerprint!
        if (file.canonicalPath !== cached.canonicalPath || !sameContentFileState(file.state, cached)) {
          if (!(await flush())) return 'FALLBACK'
          return 'FALLBACK'
        }
        entries.push({
          imageId: t.member.imageId,
          sourcePath: t.member.sourcePath,
          sourceRevision: t.member.sourceRevision,
          logicalRoot: t.root.logicalRoot,
          rootIdentity: t.root.rootIdentity,
          relativeDirectory: t.relativeDirectory,
          directoryId: t.member.directory!.directoryId,
          directoryGeneration: t.member.directory!.generation,
          canonicalPath: file.canonicalPath,
          ...file.state,
          sha256: cached.sha256
        })
      }
      if (!commits.includes(current)) commits.push(current)
      current.entries.push(...entries)
      count += entries.length
      start += group.length
      current.complete = start === pending.length
    }
    members.delete(entry.item.artworkId)
  }
  if (!(await flush())) return 'FALLBACK'
  return 'DONE'
}

export async function reuseArtworkDedupHotRun(context: DedupPipelineContext): Promise<'DONE' | 'YIELD' | 'FALLBACK'> {
  let relationReuseMs = 0
  const checkpoint = await context.transaction(async (tx) => {
    const began = performance.now()
    const checkpoint = await beginArtworkDedupHotRunReuse(tx, context.execution, {
      searchVersion: VISUAL_SEARCH_VERSION,
      featureVersion: VISUAL_ALGORITHM_VERSION,
      normalizationVersion: VISUAL_NORMALIZATION_VERSION,
      visualByteLimit: VISUAL_LIMITS.bytes
    })
    relationReuseMs = performance.now() - began
    return checkpoint
  })
  if (!checkpoint) return 'FALLBACK'
  while (!context.shouldYield()) {
    throwIfAborted(context.signal)
    const result = await context.transaction(async (tx) => {
      const started = performance.now(),
        result = await copyArtworkDedupHotRunReusePage(tx, context.execution)
      await context.onHotRunBatch?.(tx, {
        ...metrics(),
        relationReuseMs,
        resultCopyMs: performance.now() - started,
        copiedRows: result.copiedRows,
        reusedRelations: result.reusedRelations,
        discardedCopyRows: result.discardedCopyRows ?? 0,
        discardedReusedRelations: result.discardedReusedRelations ?? 0,
        ...(result.status === 'DONE' ? { wholeRunReused: true, uncheckedMedia: result.uncheckedMedia } : {})
      })
      return result
    })
    relationReuseMs = 0
    if (result.status === 'FALLBACK' || result.status === 'DONE') return result.status
  }
  return 'YIELD'
}
