import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { activeCreatorMembership, lockCreatorCatalog, visibleCreatorArtwork } from './creators'

export interface ArtworkDedupExecution {
  runId: string
  jobId: string
  executionVersion: number
}
export class ArtworkDedupConflictError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'READER_BLOCKED' = 'CONFLICT') {
    super(code)
    this.name = 'ArtworkDedupConflictError'
  }
}
const ACTIVE = ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING']
export const artworkDedupActiveStatuses = ACTIVE as readonly string[]
function limit(value: number | undefined, maximum: number) {
  const n = value ?? maximum
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) throw new RangeError('Invalid detection page size')
  return n
}
export async function lockArtworkDedupRun(tx: Prisma.TransactionClient, runId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ArtworkDedupRun" WHERE id=${runId} FOR UPDATE`)
  const run = await tx.artworkDedupRun.findUnique({ where: { id: runId } })
  if (!run) throw new ArtworkDedupConflictError('NOT_FOUND')
  return run
}
export async function assertArtworkDedupExecution(
  tx: Prisma.TransactionClient,
  execution: ArtworkDedupExecution,
  options: { allowControl?: boolean } = {}
) {
  const run = await lockArtworkDedupRun(tx, execution.runId)
  if (
    run.jobId !== execution.jobId ||
    run.executionVersion !== execution.executionVersion ||
    !(options.allowControl ? ['RUNNING', 'PAUSING', 'CANCELLING'] : ['RUNNING']).includes(run.status)
  ) {
    throw new ArtworkDedupConflictError()
  }
  return run
}
export async function freezeArtworkDedupRun(
  tx: Prisma.TransactionClient,
  input: { artistId: number; requestedBy: string; idempotencyKey: string; mode: 'INCREMENTAL' | 'FULL' }
) {
  // One statement snapshot freezes IDs; catalog changes cannot expand an existing run.
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(80432029,${input.artistId}::integer)::text`)
  const existing = await tx.artworkDedupRun.findUnique({
    where: { requestedBy_idempotencyKey: { requestedBy: input.requestedBy, idempotencyKey: input.idempotencyKey } }
  })
  if (existing) {
    if (existing.artistId !== input.artistId || existing.mode !== input.mode) throw new ArtworkDedupConflictError()
    return { run: existing, created: false }
  }
  if (!(await tx.artist.findFirst({ where: { id: input.artistId, mergedIntoId: null }, select: { id: true } }))) {
    throw new ArtworkDedupConflictError('NOT_FOUND')
  }
  if (
    await tx.artworkDedupRun.findFirst({
      where: { artistId: input.artistId, status: { in: ACTIVE } },
      select: { id: true }
    })
  ) {
    throw new ArtworkDedupConflictError()
  }
  const run = await tx.artworkDedupRun.create({ data: { id: randomUUID(), ...input } })
  const count = await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ArtworkDedupItem" ("runId","artworkId","frozenMediaRevision",status,"afterImageId","updatedAt")
    SELECT ${run.id},a.id,a."mediaRevision",'PENDING',0,CURRENT_TIMESTAMP FROM "Artwork" a
    WHERE a."deletedAt" IS NULL AND a."archiveLifecycleState"='ACTIVE'
      AND EXISTS (SELECT 1 FROM artwork_artists m JOIN artwork_artist_evidence e ON e."membershipId"=m.id
      WHERE m."artworkId"=a.id AND m."artistId"=${input.artistId} AND e.present AND e."excludedAt" IS NULL)
  `)
  return {
    run: await tx.artworkDedupRun.update({ where: { id: run.id }, data: { artworkCount: count } }),
    created: true
  }
}
export async function readArtworkDedupItemsPage(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution; afterArtworkId?: number; limit?: number; statuses?: string[] }
) {
  await assertArtworkDedupExecution(tx, input.execution)
  return tx.artworkDedupItem.findMany({
    where: {
      runId: input.execution.runId,
      artworkId: { gt: input.afterArtworkId ?? 0 },
      ...(input.statuses ? { status: { in: input.statuses } } : {})
    },
    orderBy: { artworkId: 'asc' },
    take: limit(input.limit, 100)
  })
}
export async function assertArtworkDedupItemCurrent(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution; artworkId: number }
) {
  const run = await assertArtworkDedupExecution(tx, input.execution)
  const item = await tx.artworkDedupItem.findUnique({
    where: { runId_artworkId: { runId: run.id, artworkId: input.artworkId } }
  })
  if (!item) throw new ArtworkDedupConflictError('NOT_FOUND')
  return !!(await tx.artwork.findFirst({
    where: {
      id: item.artworkId,
      mediaRevision: item.frozenMediaRevision,
      ...visibleCreatorArtwork,
      creators: { some: { artistId: run.artistId, ...activeCreatorMembership, artist: { mergedIntoId: null } } }
    },
    select: { id: true }
  }))
}
export type ArtworkDedupItemCheckpoint = Pick<
  Prisma.ArtworkDedupItemUpdateManyMutationInput,
  | 'status'
  | 'snapshotRevision'
  | 'mediaEpoch'
  | 'memberCount'
  | 'afterImageId'
  | 'sizeDigest'
  | 'contentSha256'
  | 'membersSignature'
  | 'errorCode'
>
export async function saveArtworkDedupItem(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution; artworkId: number; data: ArtworkDedupItemCheckpoint }
) {
  await assertArtworkDedupExecution(tx, input.execution)
  return tx.artworkDedupItem.update({
    where: { runId_artworkId: { runId: input.execution.runId, artworkId: input.artworkId } },
    data: input.data
  })
}
export type ArtworkDedupMediaEntry = Omit<Prisma.ArtworkDedupMediaCreateManyInput, 'runId' | 'artworkId'>
export async function saveArtworkDedupMediaPage(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution; artworkId: number; entries: ArtworkDedupMediaEntry[] }
) {
  limit(input.entries.length, 100)
  await assertArtworkDedupExecution(tx, input.execution)
  // A bounded page is replaced atomically; acknowledged earlier pages survive yielding.
  await tx.artworkDedupMedia.deleteMany({
    where: {
      runId: input.execution.runId,
      artworkId: input.artworkId,
      imageId: { in: input.entries.map((e) => e.imageId) }
    }
  })
  await tx.artworkDedupMedia.createMany({
    data: input.entries.map((e) => ({ ...e, runId: input.execution.runId, artworkId: input.artworkId }))
  })
}
export async function readArtworkDedupMediaPage(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution; artworkId: number; afterImageId?: number; limit?: number }
) {
  await assertArtworkDedupExecution(tx, input.execution)
  return tx.artworkDedupMedia.findMany({
    where: { runId: input.execution.runId, artworkId: input.artworkId, imageId: { gt: input.afterImageId ?? 0 } },
    orderBy: { imageId: 'asc' },
    take: limit(input.limit, 500)
  })
}
export type ArtworkDedupRunCheckpoint = Pick<
  Prisma.ArtworkDedupRunUpdateManyMutationInput,
  | 'stage'
  | 'processedArtworks'
  | 'completeArtworks'
  | 'changedArtworks'
  | 'failedArtworks'
  | 'skippedArtworks'
  | 'groupCount'
  | 'duplicateArtworks'
  | 'statMedia'
  | 'hashedMedia'
  | 'cacheHitMedia'
  | 'readBytes'
  | 'retryReadBytes'
  | 'lastProgressAt'
  | 'errorCode'
>
export async function updateArtworkDedupRun(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution; data: ArtworkDedupRunCheckpoint; allowControl?: boolean }
) {
  await assertArtworkDedupExecution(tx, input.execution, { allowControl: input.allowControl ?? false })
  return tx.artworkDedupRun.update({ where: { id: input.execution.runId }, data: input.data })
}
export async function claimArtworkDedupReader(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution; readerToken: string }
) {
  await assertArtworkDedupExecution(tx, input.execution)
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(8043203001)::text`
  if ((await tx.artworkDedupRun.findFirst({ where: { readerToken: { not: null } }, select: { id: true } })) || (await tx.artworkDedupOperation.findFirst({ where: { readerToken: { not: null } }, select: { id: true } }))) {
    throw new ArtworkDedupConflictError('READER_BLOCKED')
  }
  await tx.artworkDedupRun.update({
    where: { id: input.execution.runId },
    data: { readerToken: input.readerToken, readerState: 'STARTING' }
  })
}
// Actual process close, including after lease loss, is the sole authority to clear its latch.
export async function releaseArtworkDedupReader(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution; readerToken: string; blocked?: boolean }
) {
  const run = await lockArtworkDedupRun(tx, input.execution.runId)
  if (
    run.jobId !== input.execution.jobId ||
    run.executionVersion !== input.execution.executionVersion ||
    run.readerToken !== input.readerToken
  ) {
    throw new ArtworkDedupConflictError()
  }
  await tx.artworkDedupRun.update({
    where: { id: run.id },
    data: input.blocked
      ? { readerState: 'BLOCKED' }
      : { readerState: 'IDLE', readerToken: null, readerOwner: Prisma.DbNull }
  })
}

export async function buildArtworkDedupCandidates(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution }
) {
  await assertArtworkDedupExecution(tx, input.execution)
  // Canonical lists exist only inside this database statement; no pairwise graph or
  // unbounded list is materialized in the Worker or persisted in a payload.
  await tx.$executeRaw(Prisma.sql`
    WITH lists AS (
      SELECT m."artworkId", string_agg(m.size::text,',' ORDER BY m.size) canonical,count(*) n
      FROM "ArtworkDedupMedia" m JOIN "ArtworkDedupItem" i ON i."runId"=m."runId" AND i."artworkId"=m."artworkId"
      WHERE m."runId"=${input.execution.runId} AND i.status='SIZED' GROUP BY m."artworkId"
    ), candidates AS (SELECT *,count(*) OVER (PARTITION BY canonical) bucket_count FROM lists)
    UPDATE "ArtworkDedupItem" i SET "sizeDigest"=md5(c.canonical),status=CASE
      WHEN c.n<>i."memberCount" THEN 'FAILED' WHEN c.bucket_count>1 THEN 'HASHING' ELSE 'UNIQUE' END,
      "afterImageId"=0,"updatedAt"=CURRENT_TIMESTAMP FROM candidates c
    WHERE i."runId"=${input.execution.runId} AND i."artworkId"=c."artworkId" AND i.status='SIZED'
  `)
  await tx.artworkDedupItem.updateMany({
    where: { runId: input.execution.runId, status: 'SIZED' },
    data: { status: 'FAILED', errorCode: 'INCOMPLETE' }
  })
  return tx.artworkDedupRun.update({ where: { id: input.execution.runId }, data: { stage: 'HASH' } })
}
export async function refreshArtworkDedupCounts(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution; allowControl?: boolean }
) {
  await assertArtworkDedupExecution(tx, input.execution, { allowControl: input.allowControl ?? false })
  await tx.$executeRaw(Prisma.sql`
    UPDATE "ArtworkDedupRun" r SET "processedArtworks"=s.processed,"completeArtworks"=s.complete,
      "changedArtworks"=s.changed,"failedArtworks"=s.failed,"skippedArtworks"=s.skipped,"updatedAt"=CURRENT_TIMESTAMP
    FROM (SELECT count(*) FILTER (WHERE status IN ('COMPLETE','UNIQUE','CHANGED','FAILED','SKIPPED'))::int processed,
      count(*) FILTER (WHERE status='COMPLETE')::int complete,count(*) FILTER (WHERE status='CHANGED')::int changed,
      count(*) FILTER (WHERE status='FAILED')::int failed,count(*) FILTER (WHERE status IN ('UNIQUE','SKIPPED'))::int skipped
      FROM "ArtworkDedupItem" WHERE "runId"=${input.execution.runId}) s WHERE r.id=${input.execution.runId}
  `)
  return tx.artworkDedupRun.findUniqueOrThrow({ where: { id: input.execution.runId } })
}
export async function buildArtworkDedupGroups(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution }
) {
  const run = await assertArtworkDedupExecution(tx, input.execution)
  // Match creator publication's catalog -> Artwork order. Content writers and
  // Image triggers also lock Artwork before advancing evidence. Keep these locks
  // through the caller's fenced completion; do not acquire directory/Image locks here.
  await lockCreatorCatalog(tx)
  await tx.$queryRaw(Prisma.sql`
    SELECT count(*) FROM (
      SELECT a.id FROM "Artwork" a JOIN "ArtworkDedupItem" i ON i."artworkId"=a.id
      WHERE i."runId"=${run.id} AND i.status='COMPLETE' ORDER BY a.id FOR UPDATE OF a
    ) locked
  `)
  // Recheck both frozen catalog membership and the published, complete content evidence.
  await tx.$executeRaw(Prisma.sql`
    UPDATE "ArtworkDedupItem" i SET status='CHANGED',"errorCode"='CONTENT_CHANGED',"updatedAt"=CURRENT_TIMESTAMP
    WHERE i."runId"=${run.id} AND i.status='COMPLETE' AND NOT EXISTS (
      SELECT 1 FROM "Artwork" a JOIN "ArtworkContentFingerprint" f ON f."artworkId"=a.id
      JOIN "ArtworkContentSource" s ON s."artworkId"=a.id
      WHERE a.id=i."artworkId" AND a."mediaRevision"=i."frozenMediaRevision" AND a."deletedAt" IS NULL AND a."archiveLifecycleState"='ACTIVE'
        AND s."writeToken" IS NULL AND s.revision=i."snapshotRevision" AND s."mediaEpoch"=i."mediaEpoch"
        AND f."sourceRevision"=s.revision AND f."mediaEpoch"=s."mediaEpoch" AND f."contentSha256"=i."contentSha256"
        AND f."fileCount"=i."memberCount" AND f."membersSignature"=i."membersSignature" AND f."algorithmVersion"=${run.algorithmVersion}
        AND EXISTS (SELECT 1 FROM artwork_artists m JOIN artwork_artist_evidence e ON e."membershipId"=m.id JOIN "Artist" ar ON ar.id=m."artistId"
          WHERE m."artworkId"=a.id AND m."artistId"=${run.artistId} AND ar."mergedIntoId" IS NULL AND e.present AND e."excludedAt" IS NULL)
        AND i."memberCount"=(SELECT count(*) FROM "ArtworkDedupMedia" dm WHERE dm."runId"=i."runId" AND dm."artworkId"=i."artworkId" AND dm.sha256 IS NOT NULL)
    )
  `)
  await tx.artworkDedupGroup.deleteMany({ where: { runId: run.id } })
  // Canonical tuple equality, rather than a digest, decides membership. The SQL
  // aggregate partitions all items once and spills sorting through PostgreSQL.
  await tx.$executeRaw(Prisma.sql`
    WITH lists AS (
      SELECT i."artworkId",i."contentSha256",i."memberCount",string_agg(m.size::text || ':' || m.sha256,',' ORDER BY m.size,m.sha256 COLLATE "C") canonical
      FROM "ArtworkDedupItem" i JOIN "ArtworkDedupMedia" m ON m."runId"=i."runId" AND m."artworkId"=i."artworkId"
      WHERE i."runId"=${run.id} AND i.status='COMPLETE' GROUP BY i."artworkId",i."contentSha256",i."memberCount"
    ), partitioned AS (SELECT *,min("artworkId") OVER(PARTITION BY canonical) representative,count(*) OVER(PARTITION BY canonical)::int n FROM lists),
    inserted AS (INSERT INTO "ArtworkDedupGroup" (id,"runId","contentSha256","memberCount","fileCount")
      SELECT md5(${run.id} || ':' || representative::text),${run.id},min("contentSha256"),min(n),min("memberCount")
      FROM partitioned WHERE n>1 GROUP BY representative RETURNING id)
    INSERT INTO "ArtworkDedupGroupMember" ("runId","groupId","artworkId")
      SELECT ${run.id},md5(${run.id} || ':' || representative::text),"artworkId" FROM partitioned WHERE n>1
  `)
  await tx.$executeRaw(Prisma.sql`
    UPDATE "ArtworkDedupRun" SET "groupCount"=(SELECT count(*)::int FROM "ArtworkDedupGroup" WHERE "runId"=${run.id}),
      "duplicateArtworks"=(SELECT coalesce(sum("memberCount"-1),0)::int FROM "ArtworkDedupGroup" WHERE "runId"=${run.id}),stage='DONE',"updatedAt"=CURRENT_TIMESTAMP WHERE id=${run.id}
  `)
  return refreshArtworkDedupCounts(tx, input)
}

export interface ArtworkDedupReaderOwner {
  version: 1
  machineId: string
  bootId: string
  pidNamespace: string
  parentPid: number
  childPid: number
}
export async function recordArtworkDedupReaderOwner(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution; readerToken: string; owner: ArtworkDedupReaderOwner }
) {
  const run = await assertArtworkDedupExecution(tx, input.execution)
  if (run.readerToken !== input.readerToken || run.readerState !== 'STARTING') throw new ArtworkDedupConflictError()
  await tx.artworkDedupRun.update({
    where: { id: run.id },
    data: { readerState: 'ACTIVE', readerOwner: { ...input.owner } }
  })
}
export async function getArtworkDedupReaderLatch(tx: Prisma.TransactionClient) {
  return tx.artworkDedupRun.findFirst({
    where: { readerToken: { not: null } },
    select: { id: true, jobId: true, executionVersion: true, readerToken: true, readerState: true, readerOwner: true }
  })
}
