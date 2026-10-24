import path from 'node:path'
import {
  assertArtworkContentSnapshot,
  assertArtworkDedupItemCurrent,
  bindMediaContentDirectories,
  captureArtworkContentSnapshot,
  captureMediaContentDirectory,
  observeMediaContentSources,
  publishMediaContentFingerprints,
  readArtworkContentMembersPage,
  readArtworkDedupItemsPage,
  readArtworkDedupMediaPage,
  saveArtworkDedupItem,
  saveArtworkDedupMediaPage,
  updateArtworkDedupRun,
  type ArtworkContentSnapshot,
  type ArtworkDedupExecution,
  type ArtworkDedupMediaEntry,
  type MediaContentDirectorySnapshot,
  type MediaContentReadEvidence,
  type MediaContentMember,
  type MediaContentResult,
  type Prisma
} from '@pixishelf/db'
import { publishCompleteArtworkFingerprint } from '../media-content/artwork-fingerprint.ts'
import { sameContentFileState } from '../media-content/file-reader.ts'
import { MEDIA_CONTENT_ALGORITHM_VERSION } from '../media-content/fingerprint.ts'
import {
  canonicalMediaContentPath,
  MediaContentFileError,
  type ResolvedMediaContentRoot
} from '../media-content/roots.ts'
import { chunks, throwIfAborted } from '../scan/bounded.ts'
import { ARTWORK_DEDUP_LIMITS as limits } from './limits.ts'
import type { ControlledDedupReader } from './reader.ts'
import type { DedupRoots } from './reader-protocol.ts'

type ArtworkDedupItem = Awaited<ReturnType<typeof readArtworkDedupItemsPage>>[number]
export type DedupTransaction = <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>
export class DedupItemError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
export interface DedupPipelineContext {
  execution: ArtworkDedupExecution
  transaction: DedupTransaction
  roots: DedupRoots
  reader: ControlledDedupReader
  signal: AbortSignal
  forceRead: boolean
  shouldYield: () => boolean
}
const ready = <T>(result: MediaContentResult<T>): T => {
  if (result.status !== 'READY') {
    if (result.status === 'ROOT_CHANGED') throw new MediaContentFileError('ROOT_CHANGED', 'ROOT_CHANGED')
    throw new DedupItemError(result.status)
  }
  return result.value
}
function itemSnapshot(item: ArtworkDedupItem): ArtworkContentSnapshot {
  if (item.snapshotRevision === null || item.mediaEpoch === null || item.memberCount === null)
    throw new DedupItemError('INCOMPLETE')
  return {
    artworkId: item.artworkId,
    revision: item.snapshotRevision,
    mediaEpoch: item.mediaEpoch,
    memberCount: item.memberCount
  }
}
function directory(row: ArtworkDedupMediaEntry): MediaContentDirectorySnapshot {
  if (row.logicalRoot !== 'source-media:v1' && row.logicalRoot !== 'archive-media:v1')
    throw new DedupItemError('ROOT_CHANGED')
  return {
    logicalRoot: row.logicalRoot,
    rootIdentity: row.rootIdentity,
    relativeDirectory: row.relativeDirectory,
    directoryId: row.directoryId,
    generation: BigInt(row.directoryGeneration)
  }
}
async function current(context: DedupPipelineContext, tx: Prisma.TransactionClient, artworkId: number) {
  if (!(await assertArtworkDedupItemCurrent(tx, { execution: context.execution, artworkId })))
    throw new DedupItemError('STALE')
}
function target(member: MediaContentMember, roots: DedupRoots, archive: boolean) {
  const root = archive ? roots.archive : roots.source
  const sourcePath = canonicalMediaContentPath(member.sourcePath.replace(/^\/+/, ''))
  const relativePath =
    archive && roots.archiveRelativePrefix ? `${roots.archiveRelativePrefix}/${sourcePath}` : sourcePath
  return {
    root,
    relativePath,
    relativeDirectory: path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath)
  }
}

/** Each acknowledged page advances a durable media cursor; a single large artwork cannot starve. */
export async function statArtwork(context: DedupPipelineContext, item: ArtworkDedupItem): Promise<boolean> {
  let snapshot = await context.transaction(async (tx) => {
    await current(context, tx, item.artworkId)
    const captured = ready(await captureArtworkContentSnapshot(tx, { artworkId: item.artworkId }))
    if (
      item.status !== 'PENDING' &&
      (captured.revision !== item.snapshotRevision ||
        captured.mediaEpoch !== item.mediaEpoch ||
        captured.memberCount !== item.memberCount)
    )
      throw new DedupItemError('STALE')
    await saveArtworkDedupItem(tx, {
      execution: context.execution,
      artworkId: item.artworkId,
      data: {
        status: captured.memberCount === 0n ? 'SKIPPED' : 'STATTING',
        snapshotRevision: captured.revision,
        mediaEpoch: captured.mediaEpoch,
        memberCount: captured.memberCount
      }
    })
    return captured
  })
  if (snapshot.memberCount === 0n) return true
  const archive = await context.transaction(
    async (tx) =>
      (await tx.artwork.findUniqueOrThrow({ where: { id: item.artworkId }, select: { source: true } })).source ===
      'URL_ARCHIVE'
  )
  let cursor = item.afterImageId
  for (;;) {
    throwIfAborted(context.signal)
    const page = ready(
      await context.transaction((tx) =>
        readArtworkContentMembersPage(tx, { snapshot, afterImageId: cursor || null, limit: limits.mediaPage })
      )
    )
    for (const members of chunks(page.members, limits.cacheBatch)) {
      const targets = await context.transaction(async (tx) => {
        await current(context, tx, item.artworkId)
        const bindings = new Map<string, MediaContentDirectorySnapshot>()
        const targets = []
        for (const member of members) {
          const location = target(member, context.roots, archive)
          const key = `${location.root.logicalRoot}:${location.relativeDirectory}`
          if (!bindings.has(key))
            bindings.set(
              key,
              ready(
                await captureMediaContentDirectory(tx, {
                  directory: {
                    logicalRoot: location.root.logicalRoot,
                    rootIdentity: location.root.rootIdentity,
                    relativeDirectory: location.relativeDirectory
                  }
                })
              )
            )
          targets.push({ member, ...location, directory: bindings.get(key)! })
        }
        ready(
          await bindMediaContentDirectories(tx, {
            snapshot,
            bindings: targets.map((t) => ({
              imageId: t.member.imageId,
              expectedSourcePath: t.member.sourcePath,
              expectedSourceRevision: t.member.sourceRevision,
              directory: t.directory
            }))
          })
        )
        return targets
      })
      const entries: ArtworkDedupMediaEntry[] = []
      for (const batch of chunks(targets, limits.statConcurrency)) {
        // Settle all four calls before classifying a local error; no background stat leaks into the next item.
        const inspected = await Promise.allSettled(
          batch.map((t) =>
            context.reader.inspect({ root: t.root, relativePath: t.relativePath, signal: context.signal })
          )
        )
        const failure = inspected.find((result) => result.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
        for (let index = 0; index < batch.length; index++) {
          const t = batch[index]!
          const result = inspected[index]!
          if (result.status !== 'fulfilled') continue
          entries.push({
            imageId: t.member.imageId,
            sourcePath: t.member.sourcePath,
            sourceRevision: t.member.sourceRevision,
            logicalRoot: t.root.logicalRoot,
            rootIdentity: t.root.rootIdentity,
            relativeDirectory: t.relativeDirectory,
            directoryId: t.directory.directoryId,
            directoryGeneration: t.directory.generation,
            canonicalPath: result.value.canonicalPath,
            ...result.value.state,
            sha256: null
          })
        }
        if (context.shouldYield()) break
      }
      throwIfAborted(context.signal)
      snapshot = await context.transaction(async (tx) => {
        await current(context, tx, item.artworkId)
        const observed = ready(
          await observeMediaContentSources(tx, {
            snapshot,
            observations: entries.map((row) => ({
              imageId: row.imageId,
              expectedSourcePath: row.sourcePath,
              expectedSourceRevision: BigInt(row.sourceRevision),
              directory: directory(row),
              canonicalPath: row.canonicalPath,
              state: state(row)
            }))
          })
        )
        const changed = new Map(observed.changedSources.map((row) => [row.imageId, row.sourceRevision]))
        for (const row of entries) row.sourceRevision = changed.get(row.imageId) ?? row.sourceRevision
        await saveArtworkDedupMediaPage(tx, { execution: context.execution, artworkId: item.artworkId, entries })
        await saveArtworkDedupItem(tx, {
          execution: context.execution,
          artworkId: item.artworkId,
          data: {
            snapshotRevision: observed.snapshot.revision,
            afterImageId: entries.at(-1)!.imageId
          }
        })
        await updateArtworkDedupRun(tx, {
          execution: context.execution,
          data: { statMedia: { increment: entries.length } }
        })
        return observed.snapshot
      })
      cursor = entries.at(-1)!.imageId
      if (context.shouldYield()) return false
    }
    if (page.nextCursor === null) break
  }
  await context.transaction(async (tx) => {
    await current(context, tx, item.artworkId)
    if (ready(await captureArtworkContentSnapshot(tx, { artworkId: item.artworkId })).revision !== snapshot.revision)
      throw new DedupItemError('STALE')
    const count = await tx.artworkDedupMedia.count({
      where: { runId: context.execution.runId, artworkId: item.artworkId }
    })
    if (BigInt(count) !== snapshot.memberCount) throw new DedupItemError('INCOMPLETE')
    await saveArtworkDedupItem(tx, {
      execution: context.execution,
      artworkId: item.artworkId,
      data: { status: 'SIZED', afterImageId: 0 }
    })
  })
  return true
}

export async function hashArtwork(context: DedupPipelineContext, item: ArtworkDedupItem): Promise<boolean> {
  let snapshot = itemSnapshot(item)
  let cursor = item.afterImageId
  for (;;) {
    throwIfAborted(context.signal)
    const page = await context.transaction(async (tx) => {
      await current(context, tx, item.artworkId)
      const members = ready(
        await readArtworkContentMembersPage(tx, { snapshot, afterImageId: cursor || null, limit: limits.cacheBatch })
      )
      const rows = await readArtworkDedupMediaPage(tx, {
        execution: context.execution,
        artworkId: item.artworkId,
        afterImageId: cursor,
        limit: limits.cacheBatch
      })
      if (members.members.length !== rows.length) throw new DedupItemError('INCOMPLETE')
      return rows.map((row, i) => ({ row, member: members.members[i]! }))
    })
    if (!page.length) break
    const entries: ArtworkDedupMediaEntry[] = []
    const evidence: MediaContentReadEvidence[] = []
    let hits = 0
    let bytes = 0n
    let inspected = 0
    for (const { row, member } of page) {
      if (
        member.imageId !== row.imageId ||
        member.sourcePath !== row.sourcePath ||
        member.sourceRevision !== row.sourceRevision
      )
        throw new DedupItemError('STALE')
      const root: ResolvedMediaContentRoot =
        row.logicalRoot === 'source-media:v1' ? context.roots.source : context.roots.archive
      if (root.rootIdentity !== row.rootIdentity || root.logicalRoot !== row.logicalRoot)
        throw new MediaContentFileError('ROOT_CHANGED', 'ROOT_CHANGED')
      const inspection = await context.reader.inspect({ root, relativePath: row.canonicalPath, signal: context.signal })
      inspected++
      if (!sameContentFileState(inspection.state, row)) throw new DedupItemError('FILE_CHANGED')
      const cached = member.fingerprint
      if (
        !context.forceRead &&
        cached &&
        cached.algorithmVersion === MEDIA_CONTENT_ALGORITHM_VERSION &&
        cached.sourceRevision === row.sourceRevision &&
        cached.artworkMediaEpoch === snapshot.mediaEpoch &&
        cached.sourcePath === row.sourcePath &&
        cached.rootIdentity === row.rootIdentity &&
        cached.canonicalPath === row.canonicalPath &&
        sameContentFileState(cached, row)
      ) {
        entries.push({ ...row, sha256: cached.sha256 })
        hits++
      } else {
        const read = await context.reader.read({ root, relativePath: row.canonicalPath, signal: context.signal })
        if (!sameContentFileState(read.state, row)) throw new DedupItemError('FILE_CHANGED')
        entries.push({ ...row, sha256: read.sha256 })
        evidence.push({
          imageId: row.imageId,
          expectedSourcePath: row.sourcePath,
          expectedSourceRevision: row.sourceRevision,
          directory: directory(row),
          canonicalPath: row.canonicalPath,
          state: read.state,
          sha256: read.sha256,
          hashedAt: read.hashedAt
        })
        bytes += read.bytesRead
      }
      if (entries.length === limits.cacheBatch || context.shouldYield()) break
    }
    throwIfAborted(context.signal)
    snapshot = await context.transaction(async (tx) => {
      await current(context, tx, item.artworkId)
      if (evidence.length) {
        const observed = ready(await observeMediaContentSources(tx, { snapshot, observations: evidence }))
        snapshot = observed.snapshot
        const changed = new Map(observed.changedSources.map((row) => [row.imageId, row.sourceRevision]))
        for (const row of evidence) row.expectedSourceRevision = changed.get(row.imageId) ?? row.expectedSourceRevision
        for (const row of entries) row.sourceRevision = changed.get(row.imageId) ?? row.sourceRevision
        const published = await publishMediaContentFingerprints(tx, {
          snapshot,
          algorithmVersion: MEDIA_CONTENT_ALGORITHM_VERSION,
          entries: evidence
        })
        if (published.status !== 'READY') throw new DedupItemError(published.status)
      } else {
        ready(await assertArtworkContentSnapshot(tx, { snapshot }))
      }
      await saveArtworkDedupMediaPage(tx, { execution: context.execution, artworkId: item.artworkId, entries })
      await saveArtworkDedupItem(tx, {
        execution: context.execution,
        artworkId: item.artworkId,
        data: { afterImageId: entries.at(-1)!.imageId, snapshotRevision: snapshot.revision }
      })
      await updateArtworkDedupRun(tx, {
        execution: context.execution,
        data: {
          statMedia: { increment: inspected },
          hashedMedia: { increment: evidence.length },
          cacheHitMedia: { increment: hits },
          readBytes: { increment: bytes }
        }
      })
      return snapshot
    })
    cursor = entries.at(-1)!.imageId
    if (context.shouldYield()) return false
  }
  const published = ready(
    await publishCompleteArtworkFingerprint({ transaction: context.transaction, signal: context.signal, snapshot })
  )
  await context.transaction(async (tx) => {
    await current(context, tx, item.artworkId)
    await saveArtworkDedupItem(tx, {
      execution: context.execution,
      artworkId: item.artworkId,
      data: {
        status: 'COMPLETE',
        snapshotRevision: published.snapshot.revision,
        contentSha256: published.contentSha256,
        membersSignature: published.membersSignature
      }
    })
  })
  return true
}
function state(row: ArtworkDedupMediaEntry) {
  return {
    size: BigInt(row.size),
    mtimeNs: row.mtimeNs == null ? null : BigInt(row.mtimeNs),
    ctimeNs: row.ctimeNs == null ? null : BigInt(row.ctimeNs),
    deviceId: row.deviceId == null ? null : BigInt(row.deviceId),
    inode: row.inode == null ? null : BigInt(row.inode)
  }
}
