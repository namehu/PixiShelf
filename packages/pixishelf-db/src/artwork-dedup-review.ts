import { assertArtworkDedupPartialSummary, assertArtworkDedupPartialFileEvidence } from './artwork-dedup-partial'
import { assertArtworkDedupVisualSummary } from './artwork-dedup-visual'
import { freezeArtworkDedupOperationSources } from './artwork-dedup-claims'
import { artworkDedupDirectDeleteScopeDigest } from './artwork-dedup-direct-delete'
import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { lockCreatorCatalog } from './creators'
import { refreshArtworkDedupFileOwnership } from './artwork-dedup-ownership'
import { lockArtworkDedupRun } from './artwork-dedup'
import {
  ArtworkDedupOperationError,
  artworkDedupPageLimit,
  assertArtworkDedupOperationExecution,
  type ArtworkDedupOperationExecution
} from './artwork-dedup-operation'

export interface ArtworkDedupGroupChoice {
  groupId: string
  relationKind: 'EXACT' | 'CONTAINS' | 'VISUAL' | 'PARTIAL'
  visual: Prisma.JsonValue | null
  containedArtworkId: number | null
  containerArtworkId: number | null
  containedFileCount: bigint | null
  containerFileCount: bigint | null
  memberCount: number
  fileCount: bigint
  keeperArtworkId: number | null
  reviewVersion: number
  saved: boolean
  protectedCount: number
  eligible: boolean
  reason: 'UNAVAILABLE' | 'SAVED' | 'NEEDS_CHOICE' | 'ORGANIZATION' | 'LAST_VIEWED' | 'CREATED'
}
export function artworkDedupRequestDigest(input: unknown) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}
export async function lockArtworkDedupActor(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "UserBA" WHERE id=${userId} FOR KEY SHARE`
  )
  if (!rows.length) throw new ArtworkDedupOperationError('ACCOUNT_CHANGED')
}
export async function lockArtworkDedupCommand(tx: Prisma.TransactionClient, userId: string, key: string) {
  await tx.$queryRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(80432031,hashtext(${JSON.stringify([userId, key])}))::text`
  )
}
export async function readArtworkDedupGroupChoices(
  tx: Prisma.TransactionClient,
  input: { runId: string; userId: string; groupId?: string; afterGroupId?: string; limit?: number }
) {
  return tx.$queryRaw<
    ArtworkDedupGroupChoice[]
  >(Prisma.sql`SELECT * FROM artwork_dedup_group_choices(${input.runId},${input.userId}) c
    WHERE ${input.groupId ? Prisma.sql`c."groupId"=${input.groupId}` : Prisma.sql`c."groupId">${input.afterGroupId ?? ''}`}
    ORDER BY c."groupId" LIMIT ${artworkDedupPageLimit(input.limit, 101)}`)
}
export async function lockArtworkDedupReviewState(tx: Prisma.TransactionClient, runId: string, userId: string) {
  await tx.artworkDedupReviewState.upsert({
    where: { runId_userId: { runId, userId } },
    create: { runId, userId },
    update: {}
  })
  await tx.$queryRaw(
    Prisma.sql`SELECT "runId" FROM "ArtworkDedupReviewState" WHERE "runId"=${runId} AND "userId"=${userId} FOR UPDATE`
  )
  return tx.artworkDedupReviewState.findUniqueOrThrow({ where: { runId_userId: { runId, userId } } })
}
export async function saveArtworkDedupReview(
  tx: Prisma.TransactionClient,
  input: {
    userId: string
    runId: string
    groupId: string
    keeperArtworkId: number
    expectedRunVersion: number
    expectedReviewVersion: number
    idempotencyKey: string
  }
) {
  await lockArtworkDedupActor(tx, input.userId)
  await lockArtworkDedupCommand(tx, input.userId, input.idempotencyKey)
  const digest = artworkDedupRequestDigest(input)
  const prior = await tx.artworkDedupCommand.findUnique({
    where: { requestedBy_idempotencyKey: { requestedBy: input.userId, idempotencyKey: input.idempotencyKey } }
  })
  if (prior && (prior.action !== 'SAVE_REVIEW' || prior.requestDigest !== digest))
    throw new ArtworkDedupOperationError('IDEMPOTENCY_CONFLICT')
  const run = await lockArtworkDedupRun(tx, input.runId)
  const state = await lockArtworkDedupReviewState(tx, run.id, input.userId)
  const key = { runId: run.id, userId: input.userId, groupId: input.groupId }
  if (prior)
    return {
      review: await tx.artworkDedupReview.findUniqueOrThrow({ where: { runId_userId_groupId: key } }),
      reviewRevision: state.reviewRevision
    }
  if (run.status !== 'COMPLETED' || run.version !== input.expectedRunVersion)
    throw new ArtworkDedupOperationError('STALE')
  const review = await tx.artworkDedupReview.findUnique({ where: { runId_userId_groupId: key } })
  if ((review?.reviewVersion ?? 0) !== input.expectedReviewVersion) throw new ArtworkDedupOperationError('STALE')
  await lockCreatorCatalog(tx)
  await tx.$queryRaw(
    Prisma.sql`SELECT count(*) FROM (SELECT a.id FROM "Artwork" a JOIN "ArtworkDedupResultMember" m ON m."artworkId"=a.id WHERE m."runId"=${run.id} AND m."groupId"=${input.groupId} ORDER BY a.id FOR UPDATE OF a) locked`
  )
  const choice = (
    await readArtworkDedupGroupChoices(tx, { runId: run.id, userId: input.userId, groupId: input.groupId })
  )[0]
  const [member] = await tx.$queryRaw<{ artworkId: number }[]>(Prisma.sql`
    SELECT "artworkId" FROM "ArtworkDedupResultMember" WHERE "runId"=${run.id} AND "groupId"=${input.groupId} AND "artworkId"=${input.keeperArtworkId}`)
  if (!choice?.eligible || !member) throw new ArtworkDedupOperationError('STALE')
  if (choice.relationKind === 'CONTAINS' && choice.containerArtworkId !== input.keeperArtworkId)
    throw new ArtworkDedupOperationError('CONTAINMENT_DIRECTION_REQUIRED')
  const saved = await tx.artworkDedupReview.upsert({
    where: { runId_userId_groupId: key },
    create: { ...key, keeperArtworkId: input.keeperArtworkId },
    update: { keeperArtworkId: input.keeperArtworkId, reviewVersion: { increment: 1 } }
  })
  const updated = await tx.artworkDedupReviewState.update({
    where: { runId_userId: { runId: run.id, userId: input.userId } },
    data: { reviewRevision: { increment: 1 } }
  })
  await tx.artworkDedupCommand.create({
    data: {
      runId: run.id,
      requestedBy: input.userId,
      idempotencyKey: input.idempotencyKey,
      expectedVersion: input.expectedRunVersion,
      action: 'SAVE_REVIEW',
      resultingVersion: saved.reviewVersion,
      groupId: input.groupId,
      requestDigest: digest
    }
  })
  return { review: saved, reviewRevision: updated.reviewRevision }
}
export type ArtworkDedupFrozenSelection =
  | { kind: 'EXPLICIT'; groupIds: string[] }
  | { kind: 'ALL_RECOMMENDED'; excludedGroupIds: string[] }
export async function freezeArtworkDedupOperation(
  tx: Prisma.TransactionClient,
  input: { userId: string; idempotencyKey: string; preparePurpose?: 'ISOLATION' | 'DIRECT_DELETE' } & (
    | {
        runId: string
        expectedRunVersion: number
        expectedReviewRevision: number
        selection: ArtworkDedupFrozenSelection
      }
    | { sourceOperationId: string; expectedOperationVersion: number }
  )
) {
  await lockArtworkDedupActor(tx, input.userId)
  await lockArtworkDedupCommand(tx, input.userId, input.idempotencyKey)
  const digest = artworkDedupRequestDigest(input)
  const prior = await tx.artworkDedupOperation.findUnique({
    where: { requestedBy_idempotencyKey: { requestedBy: input.userId, idempotencyKey: input.idempotencyKey } }
  })
  if (prior) {
    if (prior.requestDigest !== digest) throw new ArtworkDedupOperationError('IDEMPOTENCY_CONFLICT')
    return { operation: prior, created: false }
  }
  const source =
    'sourceOperationId' in input
      ? await tx.artworkDedupOperation.findUnique({ where: { id: input.sourceOperationId } })
      : null
  if (
    'sourceOperationId' in input &&
    (!source ||
      source.version !== input.expectedOperationVersion ||
      !['STALE', 'FAILED', 'CANCELLED'].includes(source.status) ||
      source.originalAction !== 'PREPARE')
  )
    throw new ArtworkDedupOperationError('STALE')
  const run = await lockArtworkDedupRun(tx, 'runId' in input ? input.runId : source!.runId)
  if (source && 'expectedOperationVersion' in input) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "ArtworkDedupOperation" WHERE id=${source.id} FOR UPDATE`)
    const currentSource = await tx.artworkDedupOperation.findUniqueOrThrow({ where: { id: source.id } })
    if (
      currentSource.version !== input.expectedOperationVersion ||
      !['STALE', 'FAILED', 'CANCELLED'].includes(currentSource.status) ||
      currentSource.originalAction !== 'PREPARE'
    )
      throw new ArtworkDedupOperationError('STALE')
  }
  const state = await lockArtworkDedupReviewState(tx, run.id, input.userId)
  if (
    run.status !== 'COMPLETED' ||
    ('runId' in input &&
      (run.version !== input.expectedRunVersion || state.reviewRevision !== input.expectedReviewRevision))
  )
    throw new ArtworkDedupOperationError('STALE')
  const selection = 'selection' in input ? input.selection : null
  const filter = source
    ? Prisma.sql`c."groupId" IN(SELECT "groupId" FROM "ArtworkDedupOperationGroup" WHERE "operationId"=${source.id} AND status='SELECTED')`
    : selection?.kind === 'EXPLICIT'
      ? Prisma.sql`c."groupId" IN(${Prisma.join(selection.groupIds)})`
      : Prisma.sql`c."relationKind" NOT IN ('VISUAL','PARTIAL')`
  const userExcluded =
    selection?.kind === 'ALL_RECOMMENDED' && selection.excludedGroupIds.length
      ? Prisma.sql`c."groupId" IN(${Prisma.join(selection.excludedGroupIds)})`
      : Prisma.sql`false`
  const idsToValidate = selection?.kind === 'EXPLICIT' ? selection.groupIds : selection?.excludedGroupIds ?? []
  if (idsToValidate.length) {
    const [count] = await tx.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) n FROM "ArtworkDedupResult" WHERE "runId"=${run.id} AND id IN(${Prisma.join(idsToValidate)})`)
    if (Number(count?.n) !== idsToValidate.length) throw new ArtworkDedupOperationError('SCOPE_MISMATCH')
  }
  await lockCreatorCatalog(tx)
  await tx.$queryRaw(
    Prisma.sql`SELECT count(*) FROM(SELECT a.id FROM "Artwork" a JOIN "ArtworkDedupResultMember" m ON m."artworkId"=a.id JOIN "ArtworkDedupResult" c ON c.id=m."groupId" WHERE m."runId"=${run.id} AND ${source ? Prisma.sql`c.id IN(SELECT "groupId" FROM "ArtworkDedupOperationGroup" WHERE "operationId"=${source.id} AND status='SELECTED')` : selection?.kind === 'EXPLICIT' ? Prisma.sql`c.id IN(${Prisma.join(selection.groupIds)})` : Prisma.sql`true`} ORDER BY a.id FOR UPDATE OF a)locked`
  )
  if (selection?.kind === 'EXPLICIT') {
    const bad = await tx.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT count(*) n FROM artwork_dedup_group_choices(${run.id},${input.userId}) c WHERE ${filter} AND(NOT eligible OR "keeperArtworkId" IS NULL)`
    )
    if (bad[0]?.n) throw new ArtworkDedupOperationError('EXPLICIT_CHOICE_REQUIRED')
  }
  const selectedChoices = await tx.$queryRaw<{ total: bigint; visual: bigint; unsaved: bigint }[]>(Prisma.sql`
    SELECT count(*) total,count(*) FILTER(WHERE "relationKind" IN ('VISUAL','PARTIAL')) visual,
      count(*) FILTER(WHERE "relationKind" IN ('VISUAL','PARTIAL') AND NOT saved) unsaved
    FROM artwork_dedup_group_choices(${run.id},${input.userId}) c WHERE ${filter}`)
  const visualChoice = selectedChoices[0]!
  if (visualChoice.visual && (visualChoice.total !== 1n || visualChoice.unsaved || (!source && selection?.kind !== 'EXPLICIT')))
    throw new ArtworkDedupOperationError('VISUAL_SINGLE_PAIR_REQUIRED')
  if (visualChoice.visual && input.preparePurpose !== 'DIRECT_DELETE') throw new ArtworkDedupOperationError('DIRECT_DELETE_REQUIRED')
  const operation = await tx.artworkDedupOperation.create({
    data: {
      id: randomUUID(),
      runId: run.id,
      artistId: run.artistId,
      requestedBy: input.userId,
      idempotencyKey: input.idempotencyKey,
      requestDigest: digest,
      runVersion: run.version,
      frozenReviewRevision: state.reviewRevision,
      selectionKind: source ? 'REPREPARE' : selection!.kind,
      preparePurpose: input.preparePurpose ?? 'ISOLATION',
      protocolVersion: input.preparePurpose === 'DIRECT_DELETE' ? 1 : null,
      rootBindings: run.rootBindings ?? Prisma.DbNull
    }
  })
  await tx.$executeRaw(Prisma.sql`INSERT INTO "ArtworkDedupOperationGroup"("operationId","groupId","keeperArtworkId","reviewVersion","selectionBasis",status,reason,"relationKind","containedArtworkId","containerArtworkId","containedFileCount","containerFileCount",visual)
    SELECT ${operation.id},c."groupId",c."keeperArtworkId",c."reviewVersion",CASE WHEN saved THEN 'SAVED' ELSE 'RECOMMENDED' END,CASE WHEN NOT(${userExcluded}) AND eligible AND "keeperArtworkId" IS NOT NULL THEN 'SELECTED' ELSE 'EXCLUDED' END,CASE WHEN ${userExcluded} THEN 'USER_EXCLUDED' WHEN eligible AND "keeperArtworkId" IS NOT NULL THEN NULL ELSE reason END,c."relationKind",c."containedArtworkId",c."containerArtworkId",c."containedFileCount",c."containerFileCount",c.visual
    FROM artwork_dedup_group_choices(${run.id},${input.userId}) c WHERE ${filter}`)
  // A result may share artworks with another result. Reject competing copies and
  // retain/delete conflicts before the unique operation-artwork rows are materialized.
  const [conflicts] = await tx.$queryRaw<{ bad: boolean; contains: boolean }[]>(Prisma.sql`
    SELECT EXISTS(SELECT 1 FROM "ArtworkDedupOperationGroup" g JOIN "ArtworkDedupResultMember" m ON m."runId"=${run.id} AND m."groupId"=g."groupId"
      WHERE g."operationId"=${operation.id} AND g.status='SELECTED' GROUP BY m."artworkId"
      HAVING count(*) FILTER(WHERE m."artworkId"<>g."keeperArtworkId")>1
        OR (bool_or(m."artworkId"=g."keeperArtworkId") AND bool_or(m."artworkId"<>g."keeperArtworkId"))) bad,
      EXISTS(SELECT 1 FROM "ArtworkDedupOperationGroup" WHERE "operationId"=${operation.id} AND status='SELECTED' AND "relationKind"='CONTAINS') contains`)
  if (conflicts?.bad) throw new ArtworkDedupOperationError('CONFLICTING_SELECTION')
  if (conflicts?.contains && input.preparePurpose !== 'DIRECT_DELETE')
    throw new ArtworkDedupOperationError('DIRECT_DELETE_REQUIRED')
  if (conflicts?.contains) await tx.artworkDedupOperation.update({ where: { id: operation.id }, data: { protocolVersion: 2 } })
  if (visualChoice.visual) {
    const group = await tx.artworkDedupOperationGroup.findFirstOrThrow({ where: { operationId: operation.id, relationKind: { in: ['VISUAL', 'PARTIAL'] } } })
    if (group.relationKind === 'PARTIAL') assertArtworkDedupPartialSummary(group.visual)
    else assertArtworkDedupVisualSummary(group.visual)
    await tx.artworkDedupOperation.update({ where: { id: operation.id }, data: { protocolVersion: group.relationKind === 'PARTIAL' ? 4 : 3 } })
  }
  await tx.$executeRaw(Prisma.sql`INSERT INTO "ArtworkDedupOperationArtwork"("operationId","artworkId","groupId",role,title,"sourceLabel","artworkCreatedAt","isUrl","frozenMediaRevision","snapshotRevision","mediaEpoch","membersSignature","contentSha256","algorithmVersion","memberCount","organizationSignature","sourceSignature","creatorSignature","storagePath","storageKey","metaSource","externalId","updatedAt")
    SELECT DISTINCT ON (a.id) ${operation.id},a.id,g."groupId",CASE WHEN a.id=g."keeperArtworkId" THEN 'KEEPER' ELSE 'COPY' END,a.title,a.source::text,a."createdAt",a."createdVia"='URL_ARCHIVE',i."frozenMediaRevision",i."snapshotRevision",i."mediaEpoch",i."membersSignature",i."contentSha256",${run.algorithmVersion},i."memberCount",artwork_dedup_organization_signature(a.id),artwork_dedup_source_signature(a.id),artwork_dedup_creator_signature(a.id),a."storagePath",a."storageKey",a."metaSource",a."externalId",CURRENT_TIMESTAMP
    FROM "ArtworkDedupOperationGroup" g JOIN "ArtworkDedupResultMember" m ON m."groupId"=g."groupId" AND m."runId"=${run.id} JOIN "Artwork" a ON a.id=m."artworkId" JOIN "ArtworkDedupItem" i ON i."runId"=m."runId" AND i."artworkId"=a.id WHERE g."operationId"=${operation.id} AND g.status='SELECTED' ORDER BY a.id,g."groupId"`)
  await tx.$executeRaw(
    Prisma.sql`UPDATE "ArtworkDedupOperation" SET "selectedGroups"=(SELECT count(*) FROM "ArtworkDedupOperationGroup" WHERE "operationId"=${operation.id} AND status='SELECTED'),"excludedGroups"=(SELECT count(*) FROM "ArtworkDedupOperationGroup" WHERE "operationId"=${operation.id} AND status='EXCLUDED'),keepers=(SELECT count(*) FROM "ArtworkDedupOperationArtwork" WHERE "operationId"=${operation.id} AND role='KEEPER'),copies=(SELECT count(*) FROM "ArtworkDedupOperationArtwork" WHERE "operationId"=${operation.id} AND role='COPY'),"requiresOrganizationConfirmation"=EXISTS(SELECT 1 FROM "ArtworkDedupOperationArtwork" a WHERE a."operationId"=${operation.id} AND a.role='COPY' AND(EXISTS(SELECT 1 FROM "ArtworkLike" l WHERE l."artworkId"=a."artworkId") OR EXISTS(SELECT 1 FROM "MediaMark" m WHERE m."artworkId"=a."artworkId" AND(m."bookmarkedAt" IS NOT NULL OR m."likedAt" IS NOT NULL)))) WHERE id=${operation.id}`
  )
  if (input.preparePurpose === 'DIRECT_DELETE') await tx.$executeRaw(Prisma.sql`UPDATE "ArtworkDedupOperationArtwork" SET "impactSignature"=artwork_dedup_direct_delete_impact_signature("artworkId") WHERE "operationId"=${operation.id}`)
  const result = await tx.artworkDedupOperation.findUniqueOrThrow({ where: { id: operation.id } })
  if (!result.selectedGroups) throw new ArtworkDedupOperationError('EMPTY_SELECTION')
  return { operation: result, created: true }
}
/** Locks survive through scope.complete. Reading is deliberately absent from authorization evidence. */
export async function validateArtworkDedupOperationSnapshot(
  tx: Prisma.TransactionClient,
  operationId: string,
  artworkId?: number
) {
  if (
    artworkId !== undefined &&
    !(await tx.artworkDedupOperationArtwork.findUnique({
      where: { operationId_artworkId: { operationId, artworkId } },
      select: { artworkId: true }
    }))
  )
    throw new ArtworkDedupOperationError('SCOPE_MISMATCH')
  const selected = artworkId === undefined ? Prisma.empty : Prisma.sql`AND o."artworkId"=${artworkId}`
  await lockCreatorCatalog(tx)
  await tx.$queryRaw(
    Prisma.sql`SELECT count(*) FROM(SELECT a.id FROM "Artwork" a JOIN "ArtworkDedupOperationArtwork" o ON o."artworkId"=a.id WHERE o."operationId"=${operationId} ${selected} ORDER BY a.id FOR UPDATE OF a)locked`
  )
  const rows = await tx.$queryRaw<
    { artworkId: number }[]
  >(Prisma.sql`SELECT o."artworkId" FROM "ArtworkDedupOperationArtwork" o LEFT JOIN "Artwork" a ON a.id=o."artworkId" LEFT JOIN "ArtworkContentSource" s ON s."artworkId"=a.id LEFT JOIN "ArtworkContentFingerprint" f ON f."artworkId"=a.id
    WHERE o."operationId"=${operationId} ${selected} AND NOT coalesce(a.id IS NOT NULL AND a."mediaRevision"=o."frozenMediaRevision" AND (a."deletedAt" IS NULL OR o.role='COPY' AND o.status='DELETING' AND EXISTS(SELECT 1 FROM "ArtworkDedupOperation" p WHERE p.id=o."operationId" AND p.mode='DIRECT_DELETE' AND p."freshVerifiedExecutionVersion" IS NOT NULL)) AND a."archiveLifecycleState"='ACTIVE' AND s."writeToken" IS NULL AND COALESCE(s.revision,0)=o."snapshotRevision" AND COALESCE(s."mediaEpoch",0)=o."mediaEpoch" AND f."sourceRevision"=COALESCE(s.revision,0) AND f."mediaEpoch"=COALESCE(s."mediaEpoch",0) AND f."membersSignature"=o."membersSignature" AND f."contentSha256"=o."contentSha256" AND f."algorithmVersion"=o."algorithmVersion" AND f."fileCount"=o."memberCount" AND NOT EXISTS(SELECT 1 FROM "ArtworkDedupClaim" c WHERE c."artworkId"=a.id AND c."operationId"<>o."operationId") AND (o."impactSignature" IS NULL OR artwork_dedup_direct_delete_impact_signature(a.id)=o."impactSignature") AND artwork_dedup_organization_signature(a.id)=o."organizationSignature" AND artwork_dedup_source_signature(a.id)=o."sourceSignature" AND artwork_dedup_creator_signature(a.id)=o."creatorSignature",false) ORDER BY o."artworkId" LIMIT 1`)
  return rows.length === 0
}
export async function completeArtworkDedupPrepare(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupOperationExecution }
) {
  const op = await assertArtworkDedupOperationExecution(tx, input.execution)
  if (op.mode !== 'PREPARE' || !['ISOLATION', 'DIRECT_DELETE'].includes(op.preparePurpose)) throw new ArtworkDedupOperationError('INVALID_STATE')
  await tx.$queryRaw(
    Prisma.sql`SELECT "runId" FROM "ArtworkDedupReviewState" WHERE "runId"=${op.runId} AND "userId"=${op.requestedBy} FOR SHARE`
  )
  const state = await tx.artworkDedupReviewState.findUnique({
    where: { runId_userId: { runId: op.runId, userId: op.requestedBy } }
  })
  if (op.preparePurpose === 'DIRECT_DELETE') await freezeArtworkDedupOperationSources(tx, op.id)
  const valid =
    state?.reviewRevision === op.frozenReviewRevision && (await validateArtworkDedupOperationSnapshot(tx, op.id))
  if (!valid)
    return tx.artworkDedupOperation.update({
      where: { id: op.id },
      data: { status: 'STALE', stage: 'DONE', errorCode: 'SNAPSHOT_CHANGED', version: { increment: 1 } }
    })
  const pending = await tx.artworkDedupOperationArtwork.count({
    where: { operationId: op.id, OR: [{ inventoryComplete: false }, { inspectionComplete: false }] }
  })
  const missing = await tx.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`SELECT count(*) n FROM "Image" i JOIN "ArtworkDedupOperationArtwork" a ON a."artworkId"=i."artworkId" WHERE a."operationId"=${op.id} AND (NOT EXISTS(SELECT 1 FROM "ArtworkDedupOperationFile" f WHERE f."operationId"=a."operationId" AND f."artworkId"=a."artworkId" AND f."referenceKey"='media:'||i.id::text AND f."imageId"=i.id AND f.role='MEDIA') OR (i."chaptersPath" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "ArtworkDedupOperationFile" f WHERE f."operationId"=a."operationId" AND f."artworkId"=a."artworkId" AND f."referenceKey"='chapter:'||i.id::text AND f."imageId"=i.id AND f.role='CHAPTER')))`
  )
  const sourceMissing = await tx.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`SELECT count(*) n FROM "ArtworkDedupOperationArtwork" a WHERE a."operationId"=${op.id} AND ((a."metaSource" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "ArtworkDedupOperationFile" f WHERE f."operationId"=a."operationId" AND f."artworkId"=a."artworkId" AND f."referenceKey"='meta:'||a."artworkId"::text AND f.role='SOURCE_FILE')) OR (a."isUrl" AND NOT EXISTS(SELECT 1 FROM "ArtworkDedupOperationFile" f WHERE f."operationId"=a."operationId" AND f."artworkId"=a."artworkId" AND f."revisionId" IS NOT NULL AND f.role='SOURCE_FILE')))`
  )
  if (pending || missing[0]?.n || sourceMissing[0]?.n) throw new ArtworkDedupOperationError('INCOMPLETE_INVENTORY')
  const ownership = await refreshArtworkDedupFileOwnership(tx, { operationId: op.id, rootBindings: op.rootBindings })
  if (ownership.changedFiles > ownership.updatedFiles)
    return tx.artworkDedupOperation.update({
      where: { id: op.id },
      data: {
        status: 'STALE',
        stage: 'DONE',
        errorCode: 'OWNERSHIP_CHANGED',
        logicalBytes: null,
        preparedFiles: ownership.totalFiles,
        preparedArtworks: op.keepers + op.copies,
        version: { increment: 1 }
      }
    })
  const blocked = await tx.artworkDedupOperationFile.count({
    where: {
      operationId: op.id,
      OR: [
        { requiresReview: true },
        { blockReason: { not: null } },
        { status: { not: 'VERIFIED' } },
        { ownershipStatus: { not: 'VERIFIED' } },
        { inspectionStatus: { not: 'VERIFIED' } }
      ]
    }
  })
  const itemErrors = await tx.artworkDedupOperationArtwork.count({
    where: { operationId: op.id, errorCode: { not: null } }
  })
  const totals = await tx.$queryRaw<{ fileCount: bigint; logicalBytes: bigint | null }[]>(
    Prisma.sql`WITH copies AS(SELECT f.* FROM "ArtworkDedupOperationFile" f JOIN "ArtworkDedupOperationArtwork" a ON a."operationId"=f."operationId" AND a."artworkId"=f."artworkId" WHERE f."operationId"=${op.id} AND a.role='COPY'), paths AS(SELECT "rootIdentity","canonicalPath",min(size) size FROM copies GROUP BY "rootIdentity","canonicalPath") SELECT (SELECT count(*) FROM "ArtworkDedupOperationFile" WHERE "operationId"=${op.id}) "fileCount",CASE WHEN EXISTS(SELECT 1 FROM copies WHERE size IS NULL OR "requiresReview" OR "blockReason" IS NOT NULL OR status<>'VERIFIED' OR "ownershipStatus"<>'VERIFIED' OR "inspectionStatus"<>'VERIFIED') OR EXISTS(SELECT 1 FROM "ArtworkDedupOperationArtwork" WHERE "operationId"=${op.id} AND role='COPY' AND "errorCode" IS NOT NULL) THEN NULL ELSE coalesce((SELECT sum(size) FROM paths),0)::bigint END "logicalBytes"`
  )
  if (op.protocolVersion === 4 && !blocked && !itemErrors) {
    const group = await tx.artworkDedupOperationGroup.findFirstOrThrow({ where: { operationId: op.id, relationKind: 'PARTIAL' } })
    await assertArtworkDedupPartialFileEvidence(tx, op.id, group.visual)
  }
  return tx.artworkDedupOperation.update({
    where: { id: op.id },
    data: {
      preparedArtworks: op.keepers + op.copies,
      preparedFiles: totals[0]!.fileCount,
      logicalBytes: totals[0]!.logicalBytes,
      status: blocked || itemErrors ? 'FAILED' : 'READY',
      stage: 'DONE',
      errorCode: blocked || itemErrors ? 'INVENTORY_BLOCKED' : null,
      scopeDigest: op.preparePurpose === 'DIRECT_DELETE' && !blocked && !itemErrors ? await artworkDedupDirectDeleteScopeDigest(tx, op.id) : null,
      validatedAt: new Date(),
      version: { increment: 1 }
    }
  })
}
