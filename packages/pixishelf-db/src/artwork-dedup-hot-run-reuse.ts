import { Prisma } from '@prisma/client'
import { assertArtworkDedupExecution, type ArtworkDedupExecution } from './artwork-dedup'
import {
  ARTWORK_DEDUP_RELATION_CACHE_VERSION,
  assertArtworkDedupCacheDirectories
} from './artwork-dedup-relation-cache'
import { assertArtworkDedupVisualItemsFenced } from './artwork-dedup-visual-work'

type Run = Prisma.ArtworkDedupRunGetPayload<Record<string, never>>
const stages = ['items', 'media', 'groups', 'members', 'relations', 'pairs', 'pages', 'done'] as const
export interface ArtworkDedupHotReuseCheckpoint {
  version: 4
  kind: 'hot-run-reuse'
  sourceRunId: string
  inputDigest: string
  projectionDigest: string
  stage: (typeof stages)[number]
  cursor: string
  ordinal: number
  searchVersion: string
  featureVersion: string
  normalizationVersion: string
  visualByteLimit: number
  copiedRows: number
  reusedRelations: number
}
export function artworkDedupHotReuseCheckpoint(value: Prisma.JsonValue | null): ArtworkDedupHotReuseCheckpoint | null {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.version !== 4 ||
    value.kind !== 'hot-run-reuse'
  )
    return null
  if (
    typeof value.sourceRunId !== 'string' ||
    typeof value.inputDigest !== 'string' ||
    typeof value.projectionDigest !== 'string' ||
    typeof value.cursor !== 'string' ||
    !Number.isSafeInteger(value.ordinal) ||
    !stages.includes(value.stage as (typeof stages)[number]) ||
    typeof value.searchVersion !== 'string' ||
    typeof value.featureVersion !== 'string' ||
    typeof value.normalizationVersion !== 'string' ||
    !Number.isSafeInteger(value.visualByteLimit) ||
    !Number.isSafeInteger(value.copiedRows) ||
    !Number.isSafeInteger(value.reusedRelations)
  )
    throw new TypeError('Invalid hot reuse checkpoint')
  return value as unknown as ArtworkDedupHotReuseCheckpoint
}

async function current(tx: Prisma.TransactionClient, run: Run) {
  const ids = await tx.artworkDedupItem.findMany({
    where: { runId: run.id },
    select: { artworkId: true, status: true }
  })
  if (ids.length !== run.artworkCount || ids.some((i) => i.status !== 'COMPLETE')) return false
  if (!(await assertArtworkDedupCacheDirectories(tx, run.id))) return false
  if (
    !(await assertArtworkDedupVisualItemsFenced(
      tx,
      run,
      ids.map((i) => i.artworkId)
    ))
  )
    return false
  const [result] = await tx.$queryRaw<{ valid: boolean }[]>(Prisma.sql`
    SELECT NOT EXISTS (
      SELECT 1 FROM "ArtworkDedupItem" i LEFT JOIN "ArtworkContentFingerprint" f ON f."artworkId"=i."artworkId"
      WHERE i."runId"=${run.id} AND (f."artworkId" IS NULL OR f."algorithmVersion"<>${run.algorithmVersion} OR
        f."sourceRevision" IS DISTINCT FROM i."snapshotRevision" OR f."mediaEpoch" IS DISTINCT FROM i."mediaEpoch" OR
        f."fileCount" IS DISTINCT FROM i."memberCount" OR f."contentSha256" IS DISTINCT FROM i."contentSha256" OR f."membersSignature" IS DISTINCT FROM i."membersSignature" OR
        i."memberCount"<>(SELECT count(*) FROM "ArtworkDedupMedia" m WHERE m."runId"=i."runId" AND m."artworkId"=i."artworkId"))
    ) AND NOT EXISTS (
      SELECT 1 FROM "ArtworkDedupMedia" m JOIN "ArtworkDedupItem" i ON i."runId"=m."runId" AND i."artworkId"=m."artworkId"
      LEFT JOIN "Image" image ON image.id=m."imageId" LEFT JOIN "MediaContentSource" s ON s."imageId"=m."imageId"
      LEFT JOIN "MediaContentFingerprint" f ON f."imageId"=m."imageId"
      WHERE m."runId"=${run.id} AND (image.id IS NULL OR image."artworkId" IS DISTINCT FROM m."artworkId" OR image.path IS DISTINCT FROM m."sourcePath" OR
        s.revision IS DISTINCT FROM m."sourceRevision" OR s."writeToken" IS NOT NULL OR s."directoryStateId" IS DISTINCT FROM m."directoryId" OR
        f."algorithmVersion" IS DISTINCT FROM ${run.algorithmVersion} OR f."sourceRevision" IS DISTINCT FROM m."sourceRevision" OR f."artworkMediaEpoch" IS DISTINCT FROM i."mediaEpoch" OR
        (f."sourcePath",f."rootIdentity",f."canonicalPath",f.size,f."mtimeNs",f."ctimeNs",f."deviceId",f.inode,f.sha256)
          IS DISTINCT FROM (m."sourcePath",m."rootIdentity",m."canonicalPath",m.size,m."mtimeNs",m."ctimeNs",m."deviceId",m.inode,m.sha256))
    ) AS valid`)
  return !!result?.valid
}
async function inputDigest(tx: Prisma.TransactionClient, run: Run) {
  const [row] = await tx.$queryRaw<{ digest: string }[]>(Prisma.sql`
    SELECT encode(sha256(convert_to(${run.artistId}::text || ':' || ${run.algorithmVersion}::text || ':' || ${run.includeSuspectedVersions}::text || ':' ||
      COALESCE((SELECT string_agg(concat_ws(':',"artworkId","snapshotRevision","mediaEpoch","memberCount","contentSha256","membersSignature"),',' ORDER BY "artworkId")
        FROM "ArtworkDedupItem" WHERE "runId"=${run.id}),'') || ':' ||
      COALESCE((SELECT string_agg(row("artworkId","imageId","sourcePath","sourceRevision","logicalRoot","rootIdentity","relativeDirectory","directoryId","directoryGeneration","canonicalPath",size,"mtimeNs","ctimeNs","deviceId",inode,sha256)::text,',' ORDER BY "imageId")
        FROM "ArtworkDedupMedia" WHERE "runId"=${run.id}),''),'UTF8')),'hex') digest`)
  return row!.digest
}
/** Order and media classification are metadata separate from content identity. Hold it stable through this copy commit. */
async function projectionDigest(tx: Prisma.TransactionClient, runId: string) {
  const [row] = await tx.$queryRaw<{ digest: string }[]>(Prisma.sql`
    WITH positions AS MATERIALIZED (
      SELECT image.id,image."sortOrder",image."mediaType" FROM "Image" image JOIN "ArtworkDedupMedia" m ON m."imageId"=image.id
      WHERE m."runId"=${runId} ORDER BY image.id FOR SHARE OF image
    ) SELECT encode(sha256(convert_to(coalesce(string_agg(id::text || ':' || "sortOrder"::text || ':' || "mediaType"::text,',' ORDER BY id),''),'UTF8')),'hex') digest FROM positions`)
  return row!.digest
}
// Same canonical JSON identity as visualIdentity(), computed inside PostgreSQL without transferring views.
const visualIdentity = Prisma.sql`encode(sha256(convert_to('[' || concat_ws(',',m."imageId"::text,to_json(m."sourcePath")::text,to_json(m."sourceRevision"::text)::text,
  to_json(m."rootIdentity")::text,to_json(m."directoryId")::text,to_json(m."directoryGeneration"::text)::text,to_json(m."canonicalPath")::text,to_json(m.sha256)::text,
  to_json(m.size::text)::text,coalesce(to_json(m."mtimeNs"::text)::text,'null'),coalesce(to_json(m."ctimeNs"::text)::text,'null'),coalesce(to_json(m."deviceId"::text)::text,'null'),coalesce(to_json(m.inode::text)::text,'null')) || ']','UTF8')),'hex')`
async function compatible(tx: Prisma.TransactionClient, run: Run, checkpoint: ArtworkDedupHotReuseCheckpoint) {
  const [source] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT r.id FROM "ArtworkDedupRun" r WHERE r.id=${checkpoint.sourceRunId} AND r."artistId"=${run.artistId} AND r.status='COMPLETED' AND r.stage='DONE'
      AND r."algorithmVersion"=${run.algorithmVersion} AND r."relationCacheVersion"=${ARTWORK_DEDUP_RELATION_CACHE_VERSION}
      AND r."includeSuspectedVersions"=${run.includeSuspectedVersions} AND r."artworkCount"=${run.artworkCount}
      AND (SELECT count(*) FROM "ArtworkDedupItem" WHERE "runId"=r.id)=r."artworkCount"
      AND (NOT r."includeSuspectedVersions" OR (r."visualSearchVersion"=${checkpoint.searchVersion} AND r."visualSearchComplete" AND
        (r."visualStatus"='COMPLETE' OR (r."visualStatus"='INCOMPLETE' AND r."visualIncompleteReasons"=ARRAY['UNSUPPORTED_MEDIA']::text[]))))
      AND NOT EXISTS (SELECT 1 FROM "ArtworkDedupItem" old FULL JOIN (SELECT * FROM "ArtworkDedupItem" WHERE "runId"=${run.id}) n ON n."artworkId"=old."artworkId"
        WHERE old."runId"=r.id AND (n."artworkId" IS NULL OR old.status<>'COMPLETE' OR n.status<>'COMPLETE' OR
          (old."snapshotRevision",old."mediaEpoch",old."memberCount",old."contentSha256",old."membersSignature") IS DISTINCT FROM
          (n."snapshotRevision",n."mediaEpoch",n."memberCount",n."contentSha256",n."membersSignature")))
      AND NOT EXISTS (SELECT 1 FROM "ArtworkDedupMedia" m LEFT JOIN "ArtworkDedupMedia" old ON old."runId"=r.id AND old."artworkId"=m."artworkId" AND old."imageId"=m."imageId"
        LEFT JOIN "MediaVisualFingerprint" f ON f."imageId"=m."imageId" JOIN "Image" image ON image.id=m."imageId"
        WHERE m."runId"=${run.id} AND (old."imageId" IS NULL OR
          (old."sourcePath",old."sourceRevision",old."logicalRoot",old."rootIdentity",old."relativeDirectory",old."directoryId",old."directoryGeneration",old."canonicalPath",old.size,old."mtimeNs",old."ctimeNs",old."deviceId",old.inode,old.sha256) IS DISTINCT FROM
          (m."sourcePath",m."sourceRevision",m."logicalRoot",m."rootIdentity",m."relativeDirectory",m."directoryId",m."directoryGeneration",m."canonicalPath",m.size,m."mtimeNs",m."ctimeNs",m."deviceId",m.inode,m.sha256) OR
          (r."includeSuspectedVersions" AND (
            (old."visualStatus"='UNCHECKED' AND (image."mediaType" IN ('VIDEO','ANIMATION') OR m.size>${checkpoint.visualByteLimit}::bigint)) OR
            (image."mediaType" NOT IN ('VIDEO','ANIMATION') AND m.size<=${checkpoint.visualByteLimit}::bigint AND
              f."imageId" IS NOT NULL AND f.identity=${visualIdentity} AND f."algorithmVersion"=${checkpoint.featureVersion} AND f."normalizationVersion"=${checkpoint.normalizationVersion} AND
              ((old."visualStatus"='READY' AND f.views=old."visualViews") OR
               (old."visualStatus"='UNCHECKED' AND f.views= '{"kind":"visual-exclusion","version":1,"reason":"MULTI_FRAME"}'::jsonb)))
          ) IS NOT TRUE)))
      AND (SELECT count(*) FROM "ArtworkDedupMedia" WHERE "runId"=r.id)=(SELECT count(*) FROM "ArtworkDedupMedia" WHERE "runId"=${run.id})
    FOR SHARE OF r`)
  return !!source
}
export async function beginArtworkDedupHotRunReuse(
  tx: Prisma.TransactionClient,
  execution: ArtworkDedupExecution,
  versions: { searchVersion: string; featureVersion: string; normalizationVersion: string; visualByteLimit: number }
) {
  const run = await assertArtworkDedupExecution(tx, execution)
  const existing = artworkDedupHotReuseCheckpoint(run.visualCheckpoint)
  if (existing) return existing
  if (run.mode === 'FULL' || run.stage !== 'CANDIDATES' || !(await current(tx, run))) return null
  const sources = await tx.artworkDedupRun.findMany({
    where: {
      artistId: run.artistId,
      id: { not: run.id },
      status: 'COMPLETED',
      stage: 'DONE',
      relationCacheVersion: ARTWORK_DEDUP_RELATION_CACHE_VERSION,
      algorithmVersion: run.algorithmVersion,
      includeSuspectedVersions: run.includeSuspectedVersions,
      artworkCount: run.artworkCount
    },
    orderBy: [{ frozenAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { id: true }
  })
  if (!sources.length) return null
  const checkpoint: ArtworkDedupHotReuseCheckpoint = {
    version: 4,
    kind: 'hot-run-reuse',
    sourceRunId: sources[0]!.id,
    inputDigest: await inputDigest(tx, run),
    projectionDigest: await projectionDigest(tx, run.id),
    stage: 'items',
    cursor: '',
    ordinal: 0,
    copiedRows: 0,
    reusedRelations: 0,
    ...versions
  }
  if (!(await compatible(tx, run, checkpoint))) return null
  await tx.artworkDedupRun.update({
    where: { id: run.id },
    data: { visualCheckpoint: checkpoint as unknown as Prisma.InputJsonValue }
  })
  return checkpoint
}

async function abandon(tx: Prisma.TransactionClient, run: Run) {
  const runId = run.id
  await tx.artworkDedupVisualPair.deleteMany({ where: { runId } })
  await tx.artworkDedupRelation.deleteMany({ where: { runId } })
  await tx.artworkDedupGroup.deleteMany({ where: { runId } })
  await tx.artworkDedupMedia.updateMany({
    where: { runId },
    data: { visualStatus: 'PENDING', visualViews: Prisma.DbNull }
  })
  await tx.artworkDedupItem.updateMany({
    where: { runId },
    data: { visualSignature: null, visualReuseSignature: null }
  })
  await tx.artworkDedupRun.update({
    where: { id: runId },
    data: {
      stage: 'CANDIDATES',
      visualCheckpoint: Prisma.DbNull,
      visualSearchVersion: null,
      visualSearchComplete: false,
      visualInputDigest: null,
      visualStatus: run.includeSuspectedVersions ? 'PENDING' : 'NOT_REQUESTED',
      visualIncompleteReasons: [],
      visualAfterImageId: 0,
      visualCandidatePairs: [],
      visualBudgetWaiting: false,
      visualComparisonRound: 0,
      visualRoundStartComparisons: 0,
      relationCacheVersion: null,
      originalReusedPairs: 0,
      originalComparedPairs: 0,
      visualReusedComparisons: 0,
      visualComparedComparisons: 0,
      relationAfterArtworkId: 0,
      relationAfterCandidateId: 0,
      partialAfterArtworkId: 0,
      partialAfterCandidateId: 0,
      groupCount: 0,
      duplicateArtworks: 0
    }
  })
}

async function restartProjection(
  tx: Prisma.TransactionClient,
  runId: string,
  checkpoint: ArtworkDedupHotReuseCheckpoint,
  digest: string
) {
  await tx.artworkDedupVisualPair.deleteMany({ where: { runId } })
  await tx.artworkDedupRelation.deleteMany({ where: { runId } })
  await tx.artworkDedupGroup.deleteMany({ where: { runId } })
  const next = {
    ...checkpoint,
    projectionDigest: digest,
    stage: 'items' as const,
    cursor: '',
    ordinal: 0,
    copiedRows: 0,
    reusedRelations: 0
  }
  return tx.artworkDedupRun.update({
    where: { id: runId },
    data: { stage: 'CANDIDATES', visualCheckpoint: next as unknown as Prisma.InputJsonValue }
  })
}

/** Every page locks its historical source only for this transaction. Stable IDs + cursor are atomic. */
export async function copyArtworkDedupHotRunReusePage(
  tx: Prisma.TransactionClient,
  execution: ArtworkDedupExecution
): Promise<{
  status: 'FALLBACK' | 'COPYING' | 'DONE'
  copiedRows: number
  reusedRelations: number
  uncheckedMedia: number
  discardedCopyRows?: number
  discardedReusedRelations?: number
}> {
  const run = await assertArtworkDedupExecution(tx, execution),
    checkpoint = artworkDedupHotReuseCheckpoint(run.visualCheckpoint)
  if (!checkpoint) return { status: 'FALLBACK', copiedRows: 0, reusedRelations: 0, uncheckedMedia: 0 }
  if (checkpoint.stage === 'done')
    return {
      status: 'DONE' as const,
      copiedRows: 0,
      reusedRelations: 0,
      uncheckedMedia: await tx.artworkDedupMedia.count({ where: { runId: run.id, visualStatus: 'UNCHECKED' } })
    }
  if (
    !(await current(tx, run)) ||
    (await inputDigest(tx, run)) !== checkpoint.inputDigest ||
    !(await compatible(tx, run, checkpoint))
  ) {
    await abandon(tx, run)
    return {
      status: 'FALLBACK',
      copiedRows: -checkpoint.copiedRows,
      reusedRelations: -checkpoint.reusedRelations,
      uncheckedMedia: 0,
      discardedCopyRows: checkpoint.copiedRows,
      discardedReusedRelations: checkpoint.reusedRelations
    }
  }
  const order = await projectionDigest(tx, run.id)
  if (order !== checkpoint.projectionDigest) {
    await restartProjection(tx, run.id, checkpoint, order)
    return {
      status: 'COPYING',
      copiedRows: -checkpoint.copiedRows,
      reusedRelations: -checkpoint.reusedRelations,
      uncheckedMedia: 0,
      discardedCopyRows: checkpoint.copiedRows,
      discardedReusedRelations: checkpoint.reusedRelations
    }
  }
  const old = checkpoint.sourceRunId,
    dest = run.id,
    cursor = checkpoint.cursor
  let rows: Array<{ cursor: string; ordinal?: number }> = []
  if (checkpoint.stage === 'items')
    rows = await tx.$queryRaw(Prisma.sql`
    WITH page AS MATERIALIZED (SELECT * FROM "ArtworkDedupItem" WHERE "runId"=${old} AND "artworkId">${Number(cursor || 0)} ORDER BY "artworkId" LIMIT 1000),
    copied AS (UPDATE "ArtworkDedupItem" n SET "visualSignature"=p."visualSignature","visualReuseSignature"=p."visualSignature" FROM page p WHERE n."runId"=${dest} AND n."artworkId"=p."artworkId" RETURNING n."artworkId") SELECT "artworkId"::text cursor FROM page ORDER BY "artworkId"`)
  if (checkpoint.stage === 'media')
    rows = await tx.$queryRaw(Prisma.sql`
    WITH page AS MATERIALIZED (SELECT * FROM "ArtworkDedupMedia" WHERE "runId"=${old} AND "imageId">${Number(cursor || 0)} ORDER BY "imageId" LIMIT 1000),
    copied AS (UPDATE "ArtworkDedupMedia" n SET "visualStatus"=p."visualStatus","visualViews"=p."visualViews" FROM page p WHERE n."runId"=${dest} AND n."artworkId"=p."artworkId" AND n."imageId"=p."imageId" RETURNING n."imageId") SELECT "imageId"::text cursor FROM page ORDER BY "imageId"`)
  if (checkpoint.stage === 'groups')
    rows = await tx.$queryRaw(Prisma.sql`
    WITH page AS MATERIALIZED (SELECT * FROM "ArtworkDedupGroup" WHERE "runId"=${old} AND id>${cursor} ORDER BY id LIMIT 1000),
    copied AS (INSERT INTO "ArtworkDedupGroup" (id,"runId","contentSha256","memberCount","fileCount") SELECT md5(${dest} || ':' || p.id),${dest},p."contentSha256",p."memberCount",p."fileCount" FROM page p ON CONFLICT DO NOTHING RETURNING id) SELECT id cursor FROM page ORDER BY id`)
  if (checkpoint.stage === 'members')
    rows = await tx.$queryRaw(Prisma.sql`
    WITH page AS MATERIALIZED (SELECT * FROM "ArtworkDedupGroupMember" WHERE "runId"=${old} AND "artworkId">${Number(cursor || 0)} ORDER BY "artworkId" LIMIT 1000),
    copied AS (INSERT INTO "ArtworkDedupGroupMember" ("runId","groupId","artworkId") SELECT ${dest},md5(${dest} || ':' || "groupId"),"artworkId" FROM page ON CONFLICT DO NOTHING RETURNING "artworkId") SELECT "artworkId"::text cursor FROM page ORDER BY "artworkId"`)
  if (checkpoint.stage === 'relations')
    rows = await tx.$queryRaw(Prisma.sql`
    WITH page AS MATERIALIZED (SELECT * FROM "ArtworkDedupRelation" WHERE "runId"=${old} AND id>${cursor} ORDER BY id LIMIT 1000),
    copied AS (INSERT INTO "ArtworkDedupRelation" (id,"runId","containedArtworkId","containerArtworkId","containedFileCount","containerFileCount")
      SELECT 'contains:' || ${dest} || ':' || "containedArtworkId" || ':' || "containerArtworkId",${dest},"containedArtworkId","containerArtworkId","containedFileCount","containerFileCount" FROM page ON CONFLICT DO NOTHING RETURNING id) SELECT id cursor FROM page ORDER BY id`)
  if (checkpoint.stage === 'pairs')
    rows = await tx.$queryRaw(Prisma.sql`
    WITH page AS MATERIALIZED (SELECT * FROM "ArtworkDedupVisualPair" WHERE "runId"=${old} AND id>${cursor} ORDER BY id LIMIT 1000),
    copied AS (INSERT INTO "ArtworkDedupVisualPair" (id,"runId","relationKind","leftArtworkId","rightArtworkId",summary)
      SELECT lower("relationKind") || ':' || ${dest} || ':' || "leftArtworkId" || ':' || "rightArtworkId",${dest},"relationKind","leftArtworkId","rightArtworkId",summary FROM page ON CONFLICT DO NOTHING RETURNING id) SELECT id cursor FROM page ORDER BY id`)
  if (checkpoint.stage === 'pages')
    rows = await tx.$queryRaw(Prisma.sql`
    WITH page AS MATERIALIZED (SELECT p.*,r."relationKind",r."leftArtworkId",r."rightArtworkId" FROM "ArtworkDedupVisualPage" p JOIN "ArtworkDedupVisualPair" r ON r.id=p."pairId"
      WHERE r."runId"=${old} AND (p."pairId",p.ordinal)>(${cursor},${checkpoint.ordinal}) ORDER BY p."pairId",p.ordinal LIMIT 1000),
    positions AS MATERIALIZED (SELECT m."imageId",(row_number() OVER(PARTITION BY m."artworkId" ORDER BY i."sortOrder",m."imageId")-1)::integer idx FROM "ArtworkDedupMedia" m JOIN "Image" i ON i.id=m."imageId" WHERE m."runId"=${dest}),
    projected AS MATERIALIZED (SELECT p."pairId",p.ordinal,l.idx li,r.idx ri,
      row_number() OVER(PARTITION BY p."pairId" ORDER BY l.idx NULLS LAST,r.idx NULLS LAST,p.ordinal)::integer next_ordinal
      FROM "ArtworkDedupVisualPage" p LEFT JOIN positions l ON l."imageId"=p."leftImageId" LEFT JOIN positions r ON r."imageId"=p."rightImageId"
      WHERE p."pairId" IN (SELECT DISTINCT "pairId" FROM page)),
    copied AS (INSERT INTO "ArtworkDedupVisualPage" ("pairId",ordinal,kind,"leftImageId","rightImageId","leftIndex","rightIndex")
      SELECT lower(p."relationKind") || ':' || ${dest} || ':' || p."leftArtworkId" || ':' || p."rightArtworkId",projected.next_ordinal,p.kind,p."leftImageId",p."rightImageId",projected.li,projected.ri
      FROM page p JOIN projected ON projected."pairId"=p."pairId" AND projected.ordinal=p.ordinal ON CONFLICT DO NOTHING RETURNING ordinal)
      SELECT "pairId" cursor,ordinal FROM page ORDER BY "pairId",ordinal`)
  const reusedRelations = ['groups', 'relations', 'pairs'].includes(checkpoint.stage) ? rows.length : 0
  checkpoint.copiedRows += rows.length
  checkpoint.reusedRelations += reusedRelations
  if (rows.length === 1000) {
    checkpoint.cursor = rows.at(-1)!.cursor
    checkpoint.ordinal = rows.at(-1)!.ordinal ?? 0
  } else {
    checkpoint.stage = stages[stages.indexOf(checkpoint.stage) + 1]!
    checkpoint.cursor = ''
    checkpoint.ordinal = 0
  }
  if (checkpoint.stage === 'done') {
    // Copy scalar completion facts now; subsequent publication never needs the historical run.
    await tx.$executeRaw(Prisma.sql`UPDATE "ArtworkDedupRun" n SET stage='DONE',"visualStatus"=old."visualStatus","visualIncompleteReasons"=old."visualIncompleteReasons",
      "visualSearchVersion"=old."visualSearchVersion","visualSearchComplete"=old."visualSearchComplete","visualInputDigest"=old."visualInputDigest",
      "visualCandidatePairs"=old."visualCandidatePairs","relationCacheVersion"=old."relationCacheVersion",
      "originalReusedPairs"=old."originalReusedPairs"+old."originalComparedPairs","visualReusedComparisons"=old."visualReusedComparisons"+old."visualComparedComparisons"
      FROM "ArtworkDedupRun" old WHERE n.id=${dest} AND old.id=${old}`)
  }
  await tx.artworkDedupRun.update({
    where: { id: dest },
    data: { visualCheckpoint: checkpoint as unknown as Prisma.InputJsonValue }
  })
  return {
    status: checkpoint.stage === 'done' ? ('DONE' as const) : ('COPYING' as const),
    copiedRows: rows.length,
    reusedRelations,
    uncheckedMedia:
      checkpoint.stage === 'done'
        ? await tx.artworkDedupMedia.count({ where: { runId: dest, visualStatus: 'UNCHECKED' } })
        : 0
  }
}

/** Final authority and full input checks remain; the copied graph does not need rebuilding. */
export async function finalizeArtworkDedupHotRunReuse(tx: Prisma.TransactionClient, execution: ArtworkDedupExecution) {
  const run = await assertArtworkDedupExecution(tx, execution),
    checkpoint = artworkDedupHotReuseCheckpoint(run.visualCheckpoint)
  if (
    checkpoint?.stage !== 'done' ||
    !(await current(tx, run)) ||
    (await inputDigest(tx, run)) !== checkpoint.inputDigest
  )
    return null
  const order = await projectionDigest(tx, run.id)
  if (order !== checkpoint.projectionDigest) return restartProjection(tx, run.id, checkpoint, order)
  await tx.$executeRaw(Prisma.sql`UPDATE "ArtworkDedupRun" SET "processedArtworks"="artworkCount","completeArtworks"="artworkCount",
    "groupCount"=(SELECT count(*)::integer FROM "ArtworkDedupResult" WHERE "runId"=${run.id}),
    "duplicateArtworks"=(SELECT count(DISTINCT "artworkId")::integer FROM (
      SELECT m."artworkId" FROM "ArtworkDedupGroupMember" m WHERE m."runId"=${run.id} AND m."artworkId">(SELECT min(x."artworkId") FROM "ArtworkDedupGroupMember" x WHERE x."groupId"=m."groupId")
      UNION SELECT "containedArtworkId" FROM "ArtworkDedupRelation" WHERE "runId"=${run.id}) copies) WHERE id=${run.id}`)
  return tx.artworkDedupRun.findUniqueOrThrow({ where: { id: run.id } })
}
