import {
  bindMediaContentDirectories,
  captureArtworkContentSnapshot,
  captureMediaContentDirectory,
  observeMediaContentSources,
  publishArtworkContentFingerprint,
  publishMediaContentFingerprints,
  readArtworkContentFingerprintPage,
  readArtworkContentMembersPage,
  type ArtworkContentSnapshot,
  type MediaContentDirectorySnapshot,
  type MediaContentMember,
  type MediaContentReadEvidence,
  type MediaContentRejection,
  type MediaContentResult,
  type Prisma
} from '@pixishelf/db'
import path from 'node:path'
import { chunks, mapBounded, throwIfAborted } from '../scan/bounded.ts'
import { ArtworkContentDigest, ArtworkMemberDigest, MEDIA_CONTENT_ALGORITHM_VERSION } from './fingerprint.ts'
import { sameContentFileState, type ContentFileInspection } from './file-reader.ts'
import { canonicalMediaContentPath, type ResolvedMediaContentRoot } from './roots.ts'

export interface MediaContentReader {
  inspect(input: {
    root: ResolvedMediaContentRoot
    relativePath: string
    signal: AbortSignal
  }): Promise<ContentFileInspection>
  read(input: {
    root: ResolvedMediaContentRoot
    relativePath: string
    signal: AbortSignal
  }): Promise<ContentFileInspection & { sha256: string; hashedAt: Date; bytesRead: bigint }>
}
export interface ArtworkFingerprintMetrics {
  inspectedFiles: number
  hashedFiles: number
  cacheHits: number
  bytesRead: bigint
  cacheWrites: number
}
export interface ArtworkFingerprintInput {
  artworkId: number
  forceRead: boolean
  signal: AbortSignal
  /** Worker callers must provide the existing fenced transaction, never an unguarded client. */
  transaction: <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>
  resolveMember: (member: MediaContentMember) => Promise<{ root: ResolvedMediaContentRoot; relativePath: string }>
  reader: MediaContentReader
  /** Called only after a bounded cache batch is durable; cancellation/yield may safely stop here. */
  checkpoint?: (metrics: Readonly<ArtworkFingerprintMetrics>) => Promise<void>
}

/** Fill durable file evidence first; only then stream a new, complete artwork aggregation. */
export async function fingerprintArtworkContent(input: ArtworkFingerprintInput): Promise<
  MediaContentResult<{
    snapshot: ArtworkContentSnapshot
    contentSha256: string
    membersSignature: string
    metrics: ArtworkFingerprintMetrics
  }>
> {
  const captured = await input.transaction((tx) => captureArtworkContentSnapshot(tx, { artworkId: input.artworkId }))
  if (captured.status !== 'READY') return captured
  let snapshot = captured.value
  if (snapshot.memberCount === 0n) return { status: 'INCOMPLETE' }
  const metrics: ArtworkFingerprintMetrics = {
    inspectedFiles: 0,
    hashedFiles: 0,
    cacheHits: 0,
    bytesRead: 0n,
    cacheWrites: 0
  }
  let afterImageId: number | null = null
  for (;;) {
    throwIfAborted(input.signal)
    const page = await input.transaction((tx) =>
      readArtworkContentMembersPage(tx, { snapshot, afterImageId, limit: 500 })
    )
    if (page.status !== 'READY') return page
    for (const members of chunks(page.value.members, 100)) {
      const paths = await mapBounded(members, 4, input.signal, async (member) => {
        const target = await input.resolveMember(member)
        canonicalMediaContentPath(target.relativePath)
        const parent = path.posix.dirname(target.relativePath)
        return { member, ...target, relativeDirectory: parent === '.' ? '' : parent }
      })
      const directories = new Map<string, MediaContentDirectorySnapshot>()
      for (const target of paths) {
        const key = JSON.stringify([target.root.logicalRoot, target.relativeDirectory])
        if (directories.has(key)) continue
        const result = await input.transaction((tx) =>
          captureMediaContentDirectory(tx, {
            directory: {
              logicalRoot: target.root.logicalRoot,
              rootIdentity: target.root.rootIdentity,
              relativeDirectory: target.relativeDirectory
            }
          })
        )
        if (result.status !== 'READY') return result
        directories.set(key, result.value)
      }
      const targets = paths.map((target) => ({
        ...target,
        directory: directories.get(JSON.stringify([target.root.logicalRoot, target.relativeDirectory]))!
      }))
      const bound = await input.transaction((tx) =>
        bindMediaContentDirectories(tx, {
          snapshot,
          bindings: targets.map((target) => ({
            imageId: target.member.imageId,
            expectedSourcePath: target.member.sourcePath,
            expectedSourceRevision: target.member.sourceRevision,
            directory: target.directory
          }))
        })
      )
      if (bound.status !== 'READY') return bound
      const inspections = await mapBounded(targets, 4, input.signal, async (target) => ({
        target,
        inspection: await input.reader.inspect({
          root: target.root,
          relativePath: target.relativePath,
          signal: input.signal
        })
      }))
      metrics.inspectedFiles += inspections.length
      const observed = await input.transaction((tx) =>
        observeMediaContentSources(tx, {
          snapshot,
          observations: inspections.map(({ target, inspection }) => ({
            imageId: target.member.imageId,
            expectedSourcePath: target.member.sourcePath,
            expectedSourceRevision: target.member.sourceRevision,
            directory: target.directory,
            canonicalPath: inspection.canonicalPath,
            state: inspection.state
          }))
        })
      )
      if (observed.status !== 'READY') return observed
      snapshot = observed.value.snapshot
      const revisions = new Map(observed.value.changedSources.map((item) => [item.imageId, item.sourceRevision]))
      const entries: MediaContentReadEvidence[] = []
      for (const { target, inspection } of inspections) {
        throwIfAborted(input.signal)
        const member = target.member
        const revision = revisions.get(member.imageId) ?? member.sourceRevision
        const cached = member.fingerprint
        if (
          !input.forceRead &&
          cached &&
          !revisions.has(member.imageId) &&
          cached.algorithmVersion === MEDIA_CONTENT_ALGORITHM_VERSION &&
          cached.sourceRevision === revision &&
          cached.artworkMediaEpoch === snapshot.mediaEpoch &&
          cached.sourcePath === member.sourcePath &&
          cached.rootIdentity === inspection.rootIdentity &&
          cached.canonicalPath === inspection.canonicalPath &&
          sameContentFileState(cached, inspection.state)
        ) {
          metrics.cacheHits += 1
          continue
        }
        const read = await input.reader.read({
          root: target.root,
          relativePath: target.relativePath,
          signal: input.signal
        })
        entries.push({
          imageId: member.imageId,
          expectedSourcePath: member.sourcePath,
          expectedSourceRevision: revision,
          directory: target.directory,
          canonicalPath: read.canonicalPath,
          state: read.state,
          sha256: read.sha256,
          hashedAt: read.hashedAt
        })
        metrics.bytesRead += read.bytesRead
        metrics.hashedFiles += 1
      }
      if (entries.length > 0) {
        // Forced reads can discover changed bytes even when every observable attribute stayed equal.
        const reread = await input.transaction((tx) =>
          observeMediaContentSources(tx, { snapshot, observations: entries })
        )
        if (reread.status !== 'READY') return reread
        snapshot = reread.value.snapshot
        const changed = new Map(reread.value.changedSources.map((item) => [item.imageId, item.sourceRevision]))
        for (const entry of entries)
          entry.expectedSourceRevision = changed.get(entry.imageId) ?? entry.expectedSourceRevision
        const published = await input.transaction((tx) =>
          publishMediaContentFingerprints(tx, {
            snapshot,
            algorithmVersion: MEDIA_CONTENT_ALGORITHM_VERSION,
            entries
          })
        )
        if (published.status === 'OBSERVATION_REQUIRED') return { status: 'STALE' }
        if (published.status !== 'READY') return published
        metrics.cacheWrites += published.value.count
      }
      await input.checkpoint?.({ ...metrics })
    }
    if (page.value.nextCursor === null) break
    afterImageId = page.value.nextCursor
  }

  const published = await publishCompleteArtworkFingerprint({ ...input, snapshot })
  return published.status === 'READY' ? { status: 'READY', value: { ...published.value, metrics } } : published
}

/** Aggregate already-durable files without restarting the stat/hash pass on resumed large artworks. */
export async function publishCompleteArtworkFingerprint(
  input: Pick<ArtworkFingerprintInput, 'transaction' | 'signal'> & {
    snapshot: ArtworkContentSnapshot
  }
): Promise<MediaContentResult<{ snapshot: ArtworkContentSnapshot; contentSha256: string; membersSignature: string }>> {
  const snapshot = input.snapshot
  let afterImageId: number | null = null
  const membersHash = new ArtworkMemberDigest(snapshot.artworkId, snapshot.memberCount)
  afterImageId = null
  for (;;) {
    throwIfAborted(input.signal)
    const page = await input.transaction((tx) =>
      readArtworkContentMembersPage(tx, { snapshot, afterImageId, limit: 500 })
    )
    if (page.status !== 'READY') return page
    for (const member of page.value.members) {
      if (!member.fingerprint) return { status: 'INCOMPLETE' }
      membersHash.add({
        imageId: member.imageId,
        artworkId: member.artworkId,
        canonicalPath: member.fingerprint.canonicalPath,
        sourceRevision: member.sourceRevision
      })
    }
    if (page.value.nextCursor === null) break
    afterImageId = page.value.nextCursor
  }
  const contentHash = new ArtworkContentDigest(snapshot.memberCount)
  let cursor: { size: bigint; sha256: string; imageId: number } | null = null
  for (;;) {
    throwIfAborted(input.signal)
    const page = await input.transaction((tx) =>
      readArtworkContentFingerprintPage(tx, {
        snapshot,
        algorithmVersion: MEDIA_CONTENT_ALGORITHM_VERSION,
        after: cursor,
        limit: 500
      })
    )
    if (page.status !== 'READY') return page
    for (const entry of page.value.entries) contentHash.add(entry)
    if (page.value.nextCursor === null) break
    cursor = page.value.nextCursor
  }
  const contentSha256 = contentHash.digest()
  const membersSignature = membersHash.digest()
  const published = await input.transaction((tx) =>
    publishArtworkContentFingerprint(tx, {
      snapshot,
      algorithmVersion: MEDIA_CONTENT_ALGORITHM_VERSION,
      membersSignature,
      contentSha256,
      completedAt: new Date()
    })
  )
  if (published.status !== 'READY') return published as MediaContentRejection
  return { status: 'READY', value: { snapshot, contentSha256, membersSignature } }
}
