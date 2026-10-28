import { randomUUID } from 'node:crypto'
import { lockArtworkDedupRelationCache, artworkDedupOriginalReusableSql } from './artwork-dedup-relation-cache'
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
  input: { artistId: number; requestedBy: string; idempotencyKey: string; mode: 'INCREMENTAL' | 'FULL'; includeSuspectedVersions?: boolean }
) {
  // One statement snapshot freezes IDs; catalog changes cannot expand an existing run.
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(80432029,${input.artistId}::integer)::text`)
  const existing = await tx.artworkDedupRun.findUnique({
    where: { requestedBy_idempotencyKey: { requestedBy: input.requestedBy, idempotencyKey: input.idempotencyKey } }
  })
  if (existing) {
    if (existing.artistId !== input.artistId || existing.mode !== input.mode || existing.includeSuspectedVersions !== (input.includeSuspectedVersions ?? false)) throw new ArtworkDedupConflictError()
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
  const run = await tx.artworkDedupRun.create({ data: { id: randomUUID(), ...input, visualStatus: input.includeSuspectedVersions ? 'PENDING' : 'NOT_REQUESTED' } })
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
export type ArtworkDedupMediaEntry = Omit<Prisma.ArtworkDedupMediaCreateManyInput, 'runId' | 'artworkId' | 'visualViews'>
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
  // Inclusion can cross file-count and size buckets. Every complete nonempty inventory
  // needs SHA evidence; cached complete items already bypass this stage.
  await tx.$executeRaw(Prisma.sql`
    WITH lists AS (
      SELECT m."artworkId", string_agg(m.size::text,',' ORDER BY m.size) canonical,count(*) n
      FROM "ArtworkDedupMedia" m JOIN "ArtworkDedupItem" i ON i."runId"=m."runId" AND i."artworkId"=m."artworkId"
      WHERE m."runId"=${input.execution.runId} AND i.status='SIZED' GROUP BY m."artworkId"
    )
    UPDATE "ArtworkDedupItem" i SET "sizeDigest"=md5(c.canonical),status=CASE
      WHEN c.n<>i."memberCount" THEN 'FAILED' ELSE 'HASHING' END,
      "afterImageId"=0,"updatedAt"=CURRENT_TIMESTAMP FROM lists c
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
  input: { execution: ArtworkDedupExecution; prepareRelations?: boolean }
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
  // A missing content source is revision/epoch zero, as in captureArtworkContentSnapshot.
  await tx.$executeRaw(Prisma.sql`
    UPDATE "ArtworkDedupItem" i SET status='CHANGED',"errorCode"='CONTENT_CHANGED',"updatedAt"=CURRENT_TIMESTAMP
    WHERE i."runId"=${run.id} AND i.status='COMPLETE' AND NOT EXISTS (
      SELECT 1 FROM "Artwork" a JOIN "ArtworkContentFingerprint" f ON f."artworkId"=a.id
      LEFT JOIN "ArtworkContentSource" s ON s."artworkId"=a.id
      WHERE a.id=i."artworkId" AND a."mediaRevision"=i."frozenMediaRevision" AND a."deletedAt" IS NULL AND a."archiveLifecycleState"='ACTIVE'
        AND s."writeToken" IS NULL AND COALESCE(s.revision,0)=i."snapshotRevision" AND COALESCE(s."mediaEpoch",0)=i."mediaEpoch"
        AND f."sourceRevision"=COALESCE(s.revision,0) AND f."mediaEpoch"=COALESCE(s."mediaEpoch",0) AND f."contentSha256"=i."contentSha256"
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
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ArtworkDedupVisualPair" r WHERE r."runId"=${run.id} AND
    EXISTS(SELECT 1 FROM "ArtworkDedupItem" i WHERE i."runId"=r."runId" AND i."artworkId" IN(r."leftArtworkId",r."rightArtworkId") AND i.status<>'COMPLETE')`)
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ArtworkDedupRelation" r WHERE r."runId"=${run.id} AND
    EXISTS(SELECT 1 FROM "ArtworkDedupItem" i WHERE i."runId"=r."runId" AND i."artworkId" IN(r."containedArtworkId",r."containerArtworkId") AND i.status<>'COMPLETE')`)
  await tx.$executeRaw(Prisma.sql`
    UPDATE "ArtworkDedupRun" SET "groupCount"=(SELECT count(*)::int FROM "ArtworkDedupResult" WHERE "runId"=${run.id}),
      "duplicateArtworks"=(SELECT count(DISTINCT "artworkId")::int FROM (
        SELECT m."artworkId" FROM "ArtworkDedupGroupMember" m WHERE m."runId"=${run.id} AND m."artworkId"> (SELECT min(x."artworkId") FROM "ArtworkDedupGroupMember" x WHERE x."groupId"=m."groupId")
        UNION SELECT "containedArtworkId" FROM "ArtworkDedupRelation" WHERE "runId"=${run.id}) copies),stage=${input.prepareRelations ? 'MATCH' : 'DONE'},"updatedAt"=CURRENT_TIMESTAMP WHERE id=${run.id}
  `)
  return refreshArtworkDedupCounts(tx, input)
}

/** A rare tuple seeds at most 100 candidate artworks per fenced checkpoint.
 * Exact-group representatives avoid rediscovering the same content relation for every copy.
 */
export async function buildArtworkDedupRelationsPage(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupExecution; limit?: number }
) {
  const run = await assertArtworkDedupExecution(tx, input.execution)
  const take = limit(input.limit, 100)
  const [item] = await tx.$queryRaw<{ artworkId: number; memberCount: bigint }[]>(Prisma.sql`
    SELECT i."artworkId",i."memberCount" FROM "ArtworkDedupItem" i
    WHERE i."runId"=${run.id} AND i.status='COMPLETE' AND i."artworkId">=${run.relationAfterArtworkId}
      AND NOT EXISTS(SELECT 1 FROM "ArtworkDedupGroupMember" m JOIN "ArtworkDedupGroupMember" earlier ON earlier."groupId"=m."groupId" AND earlier."artworkId"<m."artworkId" WHERE m."runId"=i."runId" AND m."artworkId"=i."artworkId")
    ORDER BY i."artworkId" LIMIT 1`)
  if (!item) return true
  const after = item.artworkId === run.relationAfterArtworkId ? run.relationAfterCandidateId : 0
  const baseId = await lockArtworkDedupRelationCache(tx, run)
  const reusable = artworkDedupOriginalReusableSql(baseId, run.id, Prisma.sql`${item.artworkId}`, Prisma.sql`c."artworkId"`)
  const candidates = await tx.$queryRaw<{ artworkId: number; memberCount: bigint; included: boolean; reused: boolean }[]>(Prisma.sql`
    WITH required AS MATERIALIZED (
      SELECT size,sha256,count(*) n FROM "ArtworkDedupMedia" WHERE "runId"=${run.id} AND "artworkId"=${item.artworkId} GROUP BY size,sha256
    ), pivot AS (
      SELECT q.* FROM required q ORDER BY (SELECT count(DISTINCT p."artworkId") FROM "ArtworkDedupMedia" p WHERE p."runId"=${run.id} AND p.size=q.size AND p.sha256=q.sha256),q.size,q.sha256 LIMIT 1
    ), candidates AS MATERIALIZED (
      SELECT i."artworkId",i."memberCount" FROM pivot q JOIN "ArtworkDedupMedia" p ON p."runId"=${run.id} AND p.size=q.size AND p.sha256=q.sha256
      JOIN "ArtworkDedupItem" i ON i."runId"=p."runId" AND i."artworkId"=p."artworkId"
      WHERE i.status='COMPLETE' AND i."memberCount">${item.memberCount} AND i."artworkId">${after}
      AND NOT EXISTS(SELECT 1 FROM "ArtworkDedupGroupMember" m JOIN "ArtworkDedupGroupMember" earlier ON earlier."groupId"=m."groupId" AND earlier."artworkId"<m."artworkId" WHERE m."runId"=i."runId" AND m."artworkId"=i."artworkId")
      GROUP BY i."artworkId",i."memberCount",q.n HAVING count(*)>=q.n ORDER BY i."artworkId" LIMIT ${take}
    ), eligible AS MATERIALIZED (SELECT c.*,${reusable} reused FROM candidates c)
    SELECT c.*,CASE WHEN c.reused THEN EXISTS(SELECT 1 FROM "ArtworkDedupRelation" old WHERE old."runId"=${baseId}
      AND old."containedArtworkId"=${item.artworkId} AND old."containerArtworkId"=c."artworkId")
      ELSE NOT EXISTS(SELECT 1 FROM required q WHERE q.n>(SELECT count(*) FROM "ArtworkDedupMedia" p WHERE p."runId"=${run.id} AND p."artworkId"=c."artworkId" AND p.size=q.size AND p.sha256=q.sha256)) END included
    FROM eligible c ORDER BY c."artworkId"`)
  if (candidates.length) await tx.artworkDedupRun.update({ where: { id: run.id }, data: {
    originalReusedPairs: { increment: candidates.filter(c => c.reused).length },
    originalComparedPairs: { increment: candidates.filter(c => !c.reused).length }
  } })
  const matches = candidates.filter((c) => c.included)
  if (matches.length) await tx.artworkDedupRelation.createMany({
    data: matches.map((c) => ({ id: `contains:${run.id}:${item.artworkId}:${c.artworkId}`, runId: run.id,
      containedArtworkId: item.artworkId, containerArtworkId: c.artworkId,
      containedFileCount: item.memberCount, containerFileCount: c.memberCount })), skipDuplicates: true
  })
  await tx.artworkDedupRun.update({ where: { id: run.id }, data: candidates.length === take
    ? { relationAfterArtworkId: item.artworkId, relationAfterCandidateId: candidates.at(-1)!.artworkId }
    : { relationAfterArtworkId: item.artworkId + 1, relationAfterCandidateId: 0 } })
  return false
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
