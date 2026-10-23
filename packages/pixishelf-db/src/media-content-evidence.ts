import { Prisma } from '@prisma/client'
import {
  advanceArtworkContent,
  assertContentHash,
  assertContentInteger,
  assertContentLimit,
  assertContentPath,
  contentIds,
  directorySnapshot,
  lockContentArtworks,
  lockContentDirectories,
  lockContentImages,
  MAX_CONTENT_BIGINT
} from './media-content-common'
import { contentDirectoriesHaveWriter } from './media-content-directory'
import {
  MediaContentConflictError,
  type ArtworkContentSnapshot,
  type MediaContentDirectorySnapshot,
  type MediaContentFileFingerprint,
  type MediaContentFileState,
  type MediaContentFingerprintCursor,
  type MediaContentMember,
  type MediaContentObservation,
  type MediaContentReadEvidence,
  type MediaContentResult,
  type MediaContentTransaction
} from './media-content-types'

async function resultOf<T>(operation: () => Promise<T>): Promise<MediaContentResult<T>> {
  try {
    return { status: 'READY', value: await operation() }
  } catch (error) {
    if (error instanceof MediaContentConflictError) return { status: error.status }
    throw error
  }
}
async function snapshotAfterLock(tx: MediaContentTransaction, artworkId: number): Promise<ArtworkContentSnapshot> {
  const row = await tx.artwork.findUnique({
    where: { id: artworkId },
    select: { contentSource: true, _count: { select: { images: true } } }
  })
  if (!row) throw new MediaContentConflictError('MISSING')
  if (
    row.contentSource?.writeToken ||
    (await tx.mediaContentSource.count({ where: { image: { artworkId }, writeToken: { not: null } } }))
  )
    throw new MediaContentConflictError('WRITING')
  if (await artworkHasDirectoryWriter(tx, artworkId)) throw new MediaContentConflictError('WRITING')
  return {
    artworkId,
    revision: row.contentSource?.revision ?? 0n,
    mediaEpoch: row.contentSource?.mediaEpoch ?? 0n,
    memberCount: BigInt(row._count.images)
  }
}
async function artworkHasDirectoryWriter(tx: MediaContentTransaction, artworkId: number) {
  const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM "Image" i
      JOIN "MediaContentSource" s ON s."imageId" = i.id
      JOIN "MediaContentDirectoryState" d ON d.id = s."directoryStateId"
      JOIN "MediaContentDirectoryState" wd ON wd."logicalRoot" = d."logicalRoot"
      JOIN "MediaContentPathWrite" w ON w."directoryId" = wd.id
      WHERE i."artworkId" = ${artworkId} AND w.status IN ('ACTIVE','READY','RECOVERY_REQUIRED')
      AND (
        (w.scope = 'PATH' AND (d."relativeDirectory" = '' OR left(w."relativePath",length(d."relativeDirectory")+1) = d."relativeDirectory" || '/'))
        OR (w.scope = 'DIRECTORY' AND (wd."relativeDirectory" = '' OR d."relativeDirectory" = wd."relativeDirectory" OR left(d."relativeDirectory",length(wd."relativeDirectory")+1) = wd."relativeDirectory" || '/'))
      )
    ) AS "exists"`)
  return rows[0]!.exists
}
async function assertArtworkSnapshot(tx: MediaContentTransaction, snapshot: ArtworkContentSnapshot) {
  await lockContentArtworks(tx, [snapshot.artworkId])
  const artwork = await tx.artwork.findUnique({ where: { id: snapshot.artworkId }, select: { contentSource: true } })
  if (!artwork) throw new MediaContentConflictError('MISSING')
  if (artwork.contentSource?.writeToken) throw new MediaContentConflictError('WRITING')
  // Every membership/source/gate mutation advances this revision. Recounting all
  // members on every page would turn a large artwork traversal into quadratic work.
  if (
    (artwork.contentSource?.revision ?? 0n) !== snapshot.revision ||
    (artwork.contentSource?.mediaEpoch ?? 0n) !== snapshot.mediaEpoch
  )
    throw new MediaContentConflictError('STALE')
  return snapshot
}
async function lockAndAssertDirectories(
  tx: MediaContentTransaction,
  directories: readonly MediaContentDirectorySnapshot[]
) {
  const rows = await lockContentDirectories(tx, directories)
  for (const directory of directories) {
    const current = rows.get(`${directory.logicalRoot}\0${directory.relativeDirectory}`)!
    if (current.id !== directory.directoryId || current.generation !== directory.generation)
      throw new MediaContentConflictError('STALE')
  }
  if (await contentDirectoriesHaveWriter(tx, directories)) throw new MediaContentConflictError('WRITING')
}
function validateState(state: MediaContentFileState) {
  assertContentInteger(state.size, 'file size', true)
  for (const [name, value] of Object.entries(state)) {
    if (value !== null && (typeof value !== 'bigint' || value > MAX_CONTENT_BIGINT || value < -MAX_CONTENT_BIGINT - 1n))
      throw new RangeError(`Invalid ${name}`)
  }
}
function sameEvidence(cache: MediaContentFileFingerprint, entry: MediaContentObservation) {
  return (
    cache.rootIdentity === entry.directory.rootIdentity &&
    cache.sourcePath === entry.expectedSourcePath &&
    cache.canonicalPath === entry.canonicalPath &&
    cache.size === entry.state.size &&
    cache.mtimeNs === entry.state.mtimeNs &&
    cache.ctimeNs === entry.state.ctimeNs &&
    cache.deviceId === entry.state.deviceId &&
    cache.inode === entry.state.inode &&
    (entry.sha256 === undefined || cache.sha256 === entry.sha256)
  )
}
function validateEntries(entries: readonly MediaContentObservation[]) {
  assertContentLimit(entries.length, 100)
  contentIds(entries.map((entry) => entry.imageId))
  for (const entry of entries) {
    assertContentPath(entry.canonicalPath)
    const split = entry.canonicalPath.lastIndexOf('/')
    if ((split === -1 ? '' : entry.canonicalPath.slice(0, split)) !== entry.directory.relativeDirectory)
      throw new TypeError('Fingerprint must bind its immediate canonical directory')
    assertContentInteger(entry.expectedSourceRevision, 'source revision')
    validateState(entry.state)
    if (entry.sha256 !== undefined) assertContentHash(entry.sha256)
  }
}
async function batchMembers(
  tx: MediaContentTransaction,
  snapshot: ArtworkContentSnapshot,
  entries: readonly {
    imageId: number
    expectedSourcePath: string
    expectedSourceRevision: bigint
    directory: MediaContentDirectorySnapshot
  }[]
) {
  const rows = await tx.image.findMany({
    where: { id: { in: entries.map((entry) => entry.imageId) } },
    include: { contentSource: true, contentFingerprint: true }
  })
  if (rows.length !== entries.length) throw new MediaContentConflictError('STALE')
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const entry of entries) {
    const row = byId.get(entry.imageId)!
    if (
      row.artworkId !== snapshot.artworkId ||
      row.path !== entry.expectedSourcePath ||
      (row.contentSource?.revision ?? 0n) !== entry.expectedSourceRevision
    )
      throw new MediaContentConflictError('STALE')
    if (row.contentSource?.writeToken) throw new MediaContentConflictError('WRITING')
  }
  return byId
}
export async function captureArtworkContentSnapshot(
  tx: MediaContentTransaction,
  input: { artworkId: number }
): Promise<MediaContentResult<ArtworkContentSnapshot>> {
  contentIds([input.artworkId])
  return resultOf(async () => {
    await lockContentArtworks(tx, [input.artworkId])
    return snapshotAfterLock(tx, input.artworkId)
  })
}
/** Revalidate a captured snapshot; its revision also fences membership and writer changes. */
export async function assertArtworkContentSnapshot(
  tx: MediaContentTransaction,
  input: { snapshot: ArtworkContentSnapshot }
): Promise<MediaContentResult<ArtworkContentSnapshot>> {
  contentIds([input.snapshot.artworkId])
  return resultOf(() => assertArtworkSnapshot(tx, input.snapshot))
}
export async function readArtworkContentMembersPage(
  tx: MediaContentTransaction,
  input: { snapshot: ArtworkContentSnapshot; afterImageId: number | null; limit: number }
): Promise<MediaContentResult<{ members: MediaContentMember[]; nextCursor: number | null }>> {
  assertContentLimit(input.limit, 500)
  if (input.afterImageId !== null) contentIds([input.afterImageId])
  return resultOf(async () => {
    await assertArtworkSnapshot(tx, input.snapshot)
    const rows = await tx.image.findMany({
      where: {
        artworkId: input.snapshot.artworkId,
        ...(input.afterImageId === null ? {} : { id: { gt: input.afterImageId } })
      },
      orderBy: { id: 'asc' },
      take: input.limit,
      select: {
        id: true,
        artworkId: true,
        path: true,
        contentSource: { include: { directory: true } },
        contentFingerprint: true
      }
    })
    return {
      members: rows.map((row) => ({
        imageId: row.id,
        artworkId: row.artworkId!,
        sourcePath: row.path,
        sourceRevision: row.contentSource?.revision ?? 0n,
        writeToken: row.contentSource?.writeToken ?? null,
        directory: row.contentSource?.directory ? directorySnapshot(row.contentSource.directory) : null,
        fingerprint: row.contentFingerprint
      })),
      nextCursor: rows.length === input.limit ? rows.at(-1)!.id : null
    }
  })
}
export async function bindMediaContentDirectories(
  tx: MediaContentTransaction,
  input: {
    snapshot: ArtworkContentSnapshot
    bindings: Array<{
      imageId: number
      expectedSourcePath: string
      expectedSourceRevision: bigint
      directory: MediaContentDirectorySnapshot
    }>
  }
): Promise<MediaContentResult<ArtworkContentSnapshot>> {
  assertContentLimit(input.bindings.length, 100)
  const ids = contentIds(input.bindings.map((row) => row.imageId))
  return resultOf(async () => {
    await lockAndAssertDirectories(
      tx,
      input.bindings.map((row) => row.directory)
    )
    await assertArtworkSnapshot(tx, input.snapshot)
    await lockContentImages(tx, ids)
    const members = await batchMembers(tx, input.snapshot, input.bindings)
    for (const entry of input.bindings) {
      const source = members.get(entry.imageId)!.contentSource
      if (source?.directoryStateId && source.directoryStateId !== entry.directory.directoryId)
        throw new MediaContentConflictError('ROOT_CHANGED')
    }
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "MediaContentSource" ("imageId",revision,"directoryStateId","updatedAt") VALUES ${Prisma.join(input.bindings.map((entry) => Prisma.sql`(${entry.imageId},${entry.expectedSourceRevision},${entry.directory.directoryId},CURRENT_TIMESTAMP)`))} ON CONFLICT ("imageId") DO UPDATE SET "directoryStateId" = EXCLUDED."directoryStateId", "updatedAt" = CURRENT_TIMESTAMP`
    )
    return input.snapshot
  })
}
export async function observeMediaContentSources(
  tx: MediaContentTransaction,
  input: { snapshot: ArtworkContentSnapshot; observations: MediaContentObservation[] }
): Promise<
  MediaContentResult<{
    changed: boolean
    snapshot: ArtworkContentSnapshot
    changedSources: Array<{ imageId: number; sourceRevision: bigint }>
  }>
> {
  validateEntries(input.observations)
  return resultOf(async () => {
    await lockAndAssertDirectories(
      tx,
      input.observations.map((entry) => entry.directory)
    )
    await assertArtworkSnapshot(tx, input.snapshot)
    await lockContentImages(
      tx,
      input.observations.map((entry) => entry.imageId)
    )
    const members = await batchMembers(tx, input.snapshot, input.observations)
    const changedIds: number[] = []
    for (const entry of input.observations) {
      const row = members.get(entry.imageId)!
      if (row.contentSource?.directoryStateId !== entry.directory.directoryId)
        throw new MediaContentConflictError('INCOMPLETE')
      const cache = row.contentFingerprint
      if (
        cache &&
        cache.sourceRevision === entry.expectedSourceRevision &&
        cache.artworkMediaEpoch === input.snapshot.mediaEpoch &&
        !sameEvidence(cache, entry)
      )
        changedIds.push(entry.imageId)
    }
    if (!changedIds.length) return { changed: false, snapshot: input.snapshot, changedSources: [] }
    await tx.mediaContentSource.updateMany({
      where: { imageId: { in: changedIds } },
      data: { revision: { increment: 1n } }
    })
    await tx.mediaContentFingerprint.deleteMany({ where: { imageId: { in: changedIds } } })
    await advanceArtworkContent(tx, [input.snapshot.artworkId])
    const changedSources = await tx.mediaContentSource.findMany({
      where: { imageId: { in: changedIds } },
      select: { imageId: true, revision: true },
      orderBy: { imageId: 'asc' }
    })
    return {
      changed: true,
      snapshot: await snapshotAfterLock(tx, input.snapshot.artworkId),
      changedSources: changedSources.map((row) => ({ imageId: row.imageId, sourceRevision: row.revision }))
    }
  })
}
export async function publishMediaContentFingerprints(
  tx: MediaContentTransaction,
  input: { snapshot: ArtworkContentSnapshot; algorithmVersion: number; entries: MediaContentReadEvidence[] }
): Promise<MediaContentResult<{ count: number }> | { status: 'OBSERVATION_REQUIRED' }> {
  validateEntries(input.entries)
  assertContentLimit(input.algorithmVersion, 2_147_483_647)
  for (const entry of input.entries)
    if (!(entry.hashedAt instanceof Date) || !Number.isFinite(entry.hashedAt.getTime()))
      throw new TypeError('Invalid actual hash time')
  const outcome = await resultOf(async () => {
    await lockAndAssertDirectories(
      tx,
      input.entries.map((entry) => entry.directory)
    )
    await assertArtworkSnapshot(tx, input.snapshot)
    await lockContentImages(
      tx,
      input.entries.map((entry) => entry.imageId)
    )
    const members = await batchMembers(tx, input.snapshot, input.entries)
    for (const entry of input.entries) {
      const row = members.get(entry.imageId)!
      if (row.contentSource?.directoryStateId !== entry.directory.directoryId)
        throw new MediaContentConflictError('INCOMPLETE')
      if (
        row.contentFingerprint &&
        row.contentFingerprint.sourceRevision === entry.expectedSourceRevision &&
        row.contentFingerprint.artworkMediaEpoch === input.snapshot.mediaEpoch &&
        !sameEvidence(row.contentFingerprint, entry)
      )
        return false
    }
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "MediaContentFingerprint" ("imageId","algorithmVersion","rootIdentity","sourcePath","canonicalPath","sourceRevision","artworkMediaEpoch",size,"mtimeNs","ctimeNs","deviceId",inode,sha256,"hashedAt") VALUES ${Prisma.join(input.entries.map((e) => Prisma.sql`(${e.imageId},${input.algorithmVersion},${e.directory.rootIdentity},${e.expectedSourcePath},${e.canonicalPath},${e.expectedSourceRevision},${input.snapshot.mediaEpoch},${e.state.size},${e.state.mtimeNs},${e.state.ctimeNs},${e.state.deviceId},${e.state.inode},${e.sha256},${e.hashedAt})`))} ON CONFLICT ("imageId") DO UPDATE SET "algorithmVersion"=EXCLUDED."algorithmVersion","rootIdentity"=EXCLUDED."rootIdentity","sourcePath"=EXCLUDED."sourcePath","canonicalPath"=EXCLUDED."canonicalPath","sourceRevision"=EXCLUDED."sourceRevision","artworkMediaEpoch"=EXCLUDED."artworkMediaEpoch",size=EXCLUDED.size,"mtimeNs"=EXCLUDED."mtimeNs","ctimeNs"=EXCLUDED."ctimeNs","deviceId"=EXCLUDED."deviceId",inode=EXCLUDED.inode,sha256=EXCLUDED.sha256,"hashedAt"=EXCLUDED."hashedAt"`
    )
    return true
  })
  if (outcome.status !== 'READY') return outcome
  return outcome.value
    ? { status: 'READY', value: { count: input.entries.length } }
    : { status: 'OBSERVATION_REQUIRED' }
}

function validFingerprintCondition(snapshot: ArtworkContentSnapshot, algorithmVersion: number) {
  return Prisma.sql`s."writeToken" IS NULL AND s."directoryStateId" IS NOT NULL AND f."imageId" IS NOT NULL AND f."algorithmVersion"=${algorithmVersion} AND f."sourceRevision"=s.revision AND f."sourcePath"=i.path AND f."artworkMediaEpoch"=${snapshot.mediaEpoch} AND f."rootIdentity"=d."rootIdentity" AND d."rootIdentity"=r."rootIdentity" AND f.size>0 AND (CASE WHEN strpos(reverse(f."canonicalPath"),'/')=0 THEN '' ELSE left(f."canonicalPath",length(f."canonicalPath")-strpos(reverse(f."canonicalPath"),'/')) END)=d."relativeDirectory"`
}
async function assertCompleteFingerprints(
  tx: MediaContentTransaction,
  snapshot: ArtworkContentSnapshot,
  algorithmVersion: number
) {
  if (snapshot.memberCount === 0n) throw new MediaContentConflictError('INCOMPLETE')
  const rows = await tx.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`SELECT count(*)::bigint AS count FROM "Image" i JOIN "MediaContentSource" s ON s."imageId"=i.id JOIN "MediaContentFingerprint" f ON f."imageId"=i.id JOIN "MediaContentDirectoryState" d ON d.id=s."directoryStateId" JOIN "MediaContentDirectoryState" r ON r."logicalRoot"=d."logicalRoot" AND r."relativeDirectory"='' WHERE i."artworkId"=${snapshot.artworkId} AND ${validFingerprintCondition(snapshot, algorithmVersion)}`
  )
  if (rows[0]!.count !== snapshot.memberCount) throw new MediaContentConflictError('INCOMPLETE')
}
export async function readArtworkContentFingerprintPage(
  tx: MediaContentTransaction,
  input: {
    snapshot: ArtworkContentSnapshot
    algorithmVersion: number
    after: MediaContentFingerprintCursor | null
    limit: number
  }
): Promise<
  MediaContentResult<{
    entries: Array<{ imageId: number; size: bigint; sha256: string }>
    nextCursor: MediaContentFingerprintCursor | null
  }>
> {
  assertContentLimit(input.limit, 500)
  assertContentLimit(input.algorithmVersion, 2_147_483_647)
  if (input.after) {
    contentIds([input.after.imageId])
    assertContentInteger(input.after.size, 'cursor size', true)
    assertContentHash(input.after.sha256)
  }
  return resultOf(async () => {
    await assertArtworkSnapshot(tx, input.snapshot)
    if (input.after === null) await assertCompleteFingerprints(tx, input.snapshot, input.algorithmVersion)
    const entries = await tx.$queryRaw<Array<{ imageId: number; size: bigint; sha256: string }>>(
      Prisma.sql`SELECT f."imageId",f.size,f.sha256 FROM "Image" i JOIN "MediaContentFingerprint" f ON f."imageId"=i.id WHERE i."artworkId"=${input.snapshot.artworkId} ${input.after ? Prisma.sql`AND (f.size,f.sha256 COLLATE "C",f."imageId") > (${input.after.size},${input.after.sha256} COLLATE "C",${input.after.imageId})` : Prisma.empty} ORDER BY f.size,f.sha256 COLLATE "C",f."imageId" LIMIT ${input.limit}`
    )
    return { entries, nextCursor: entries.length === input.limit ? entries.at(-1)! : null }
  })
}
export async function publishArtworkContentFingerprint(
  tx: MediaContentTransaction,
  input: {
    snapshot: ArtworkContentSnapshot
    algorithmVersion: number
    membersSignature: string
    contentSha256: string
    completedAt: Date
  }
): Promise<MediaContentResult<{ artworkId: number }>> {
  assertContentLimit(input.algorithmVersion, 2_147_483_647)
  assertContentHash(input.membersSignature)
  assertContentHash(input.contentSha256)
  return resultOf(async () => {
    await assertArtworkSnapshot(tx, input.snapshot)
    await assertCompleteFingerprints(tx, input.snapshot, input.algorithmVersion)
    const data = {
      algorithmVersion: input.algorithmVersion,
      sourceRevision: input.snapshot.revision,
      mediaEpoch: input.snapshot.mediaEpoch,
      membersSignature: input.membersSignature,
      fileCount: input.snapshot.memberCount,
      contentSha256: input.contentSha256,
      completedAt: input.completedAt
    }
    await tx.artworkContentFingerprint.upsert({
      where: { artworkId: input.snapshot.artworkId },
      create: { artworkId: input.snapshot.artworkId, ...data },
      update: data
    })
    return { artworkId: input.snapshot.artworkId }
  })
}
