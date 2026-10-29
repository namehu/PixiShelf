import { assertArtworkDedupPartialSummary, assertArtworkDedupPartialFileEvidence } from './artwork-dedup-partial'
import { assertArtworkDedupVisualSummary } from './artwork-dedup-visual'
import { Prisma } from '@prisma/client'
import {
  ArtworkDedupOperationError,
  assertArtworkDedupOperationExecution,
  lockArtworkDedupOperation,
  type ArtworkDedupOperationExecution
} from './artwork-dedup-operation'
import {
  artworkDedupRequestDigest,
  lockArtworkDedupActor,
  lockArtworkDedupCommand,
  validateArtworkDedupOperationSnapshot
} from './artwork-dedup-review'
import { reopenArtworkDedupSources } from './artwork-dedup-source-release'
import { inspectArtworkDedupArchiveDrain } from './artwork-dedup-archive-drain'
import { artworkDedupBoundRoots, refreshArtworkDedupFileOwnership } from './artwork-dedup-ownership'
import { lockContentDirectories } from './media-content-common'
import { lockCreatorCatalog } from './creators'
import type { MediaContentLogicalRoot } from './media-content-types'

type Operation = Prisma.ArtworkDedupOperationGetPayload<Record<string, never>>
export interface ArtworkDedupDirectDeleteCommand {
  userId: string
  expectedUserId: string
  operationId: string
  expectedVersion: number
  idempotencyKey: string
}
function protocol(op: Operation) {
  if (op.preparePurpose !== 'DIRECT_DELETE' || ![1, 2, 3, 4].includes(op.protocolVersion ?? 0) || !op.scopeDigest) {
    throw new ArtworkDedupOperationError('DIRECT_DELETE_PROTOCOL_REQUIRED')
  }
}
/** Digest includes immutable frozen rows, not execution cursors, receipt status or current private records. */
export async function artworkDedupDirectDeleteScopeDigest(tx: Prisma.TransactionClient, operationId: string) {
  const [row] = await tx.$queryRaw<{ digest: string }[]>(Prisma.sql`
    WITH facts AS (
      SELECT 'operation' kind,o.id key,jsonb_build_array(o.id,o."runId",o."runVersion",o."requestedBy",o."frozenReviewRevision",o."preparePurpose",o."protocolVersion",o."rootBindings",o."selectedGroups",o.keepers,o.copies)::text v FROM "ArtworkDedupOperation" o WHERE o.id=${operationId}
      UNION ALL SELECT 'group',g."groupId",(CASE WHEN g."relationKind"='EXACT' THEN to_jsonb(g)-ARRAY['relationKind','containedArtworkId','containerArtworkId','containedFileCount','containerFileCount','visual'] WHEN g."relationKind"='CONTAINS' THEN to_jsonb(g)-'visual' ELSE to_jsonb(g) END)::text FROM "ArtworkDedupOperationGroup" g WHERE g."operationId"=${operationId}
      UNION ALL SELECT 'artwork',a."artworkId"::text,jsonb_build_array(a."artworkId",a."groupId",a.role,a."frozenMediaRevision",a."snapshotRevision",a."mediaEpoch",a."membersSignature",a."contentSha256",a."memberCount",a."organizationSignature",a."impactSignature",a."sourceSignature",a."creatorSignature",a."selectedForAction")::text FROM "ArtworkDedupOperationArtwork" a WHERE a."operationId"=${operationId}
      UNION ALL SELECT 'preparation','version',o."preparationVersion"::text FROM "ArtworkDedupOperation" o WHERE o.id=${operationId} AND o."preparationVersion"=2
      UNION ALL SELECT 'file',f."fileId",(CASE WHEN o."preparationVersion"=2 THEN jsonb_build_array(f."fileId",f."artworkId",f."referenceKey",f.role,f."rootIdentity",f."logicalRoot",f."canonicalPath",f."sourceRevision",f."verificationSpec") ELSE jsonb_build_array(f."fileId",f."artworkId",f."referenceKey",f.role,f."rootIdentity",f."logicalRoot",f."canonicalPath",f.size,f."mtimeNs",f."ctimeNs",f."deviceId",f.inode,f."linkCount",f.sha256,f."sourceRevision") END)::text FROM "ArtworkDedupOperationFile" f JOIN "ArtworkDedupOperation" o ON o.id=f."operationId" WHERE f."operationId"=${operationId}
      UNION ALL SELECT 'source',b."artworkId"::text||':'||b."sourceId",to_jsonb(b)::text FROM "ArtworkDedupOperationSource" b WHERE b."operationId"=${operationId}
    ) SELECT encode(sha256(convert_to(string_agg(encode(sha256(convert_to(v,'UTF8')),'hex'),'' ORDER BY kind,key),'UTF8')),'hex') digest FROM facts`)
  if (!row?.digest) throw new ArtworkDedupOperationError('EMPTY_SELECTION')
  return row.digest
}
async function command(
  tx: Prisma.TransactionClient,
  input: ArtworkDedupDirectDeleteCommand,
  action: string,
  body: unknown = input
) {
  if (input.userId !== input.expectedUserId) throw new ArtworkDedupOperationError('ACCOUNT_CHANGED')
  await lockArtworkDedupActor(tx, input.userId)
  await lockArtworkDedupCommand(tx, input.userId, input.idempotencyKey)
  const digest = artworkDedupRequestDigest(body)
  const prior = await tx.artworkDedupCommand.findUnique({
    where: { requestedBy_idempotencyKey: { requestedBy: input.userId, idempotencyKey: input.idempotencyKey } }
  })
  if (prior && (prior.action !== action || prior.requestDigest !== digest || prior.operationId !== input.operationId)) {
    throw new ArtworkDedupOperationError('IDEMPOTENCY_CONFLICT')
  }
  const op = await lockArtworkDedupOperation(tx, input.operationId)
  protocol(op)
  if (op.requestedBy !== input.userId) throw new ArtworkDedupOperationError('ACCOUNT_CHANGED')
  if (!prior && op.version !== input.expectedVersion) throw new ArtworkDedupOperationError('STALE')
  return { op, prior, digest }
}
async function remember(
  tx: Prisma.TransactionClient,
  input: ArtworkDedupDirectDeleteCommand,
  action: string,
  digest: string,
  op: Operation
) {
  await tx.artworkDedupCommand.create({
    data: {
      requestedBy: input.userId,
      idempotencyKey: input.idempotencyKey,
      runId: op.runId,
      operationId: op.id,
      action,
      requestDigest: digest,
      expectedVersion: input.expectedVersion,
      resultingVersion: op.version
    }
  })
  return op
}
/** Public adapters enforce the independent release gate, then enqueue/bind the job in this same transaction. */
export async function authorizeArtworkDedupDirectDelete(
  tx: Prisma.TransactionClient,
  input: ArtworkDedupDirectDeleteCommand & {
    purpose: 'DIRECT_DELETE'
    protocolVersion: 1 | 2 | 3 | 4
    differentContentLossConfirmed?: true
    scopeDigest: string
    externalWritesStopped: true
    permanentDeleteConfirmed: true
    organizationImpactConfirmed: true
  }
) {
  const { op, prior, digest } = await command(tx, input, 'DIRECT_DELETE')
  if (prior) return { operation: op, created: false }
  if (
    input.purpose !== 'DIRECT_DELETE' ||
    input.protocolVersion !== op.protocolVersion ||
    !input.externalWritesStopped ||
    !input.permanentDeleteConfirmed ||
    !input.organizationImpactConfirmed ||
    ([3, 4].includes(op.protocolVersion ?? 0) && input.differentContentLossConfirmed !== true)
  ) {
    throw new ArtworkDedupOperationError('CONFIRMATION_REQUIRED')
  }
  if (
    op.mode !== 'PREPARE' ||
    op.status !== 'READY' ||
    op.readerToken ||
    op.readerState !== 'IDLE' ||
    op.scopeDigest !== input.scopeDigest ||
    op.scopeDigest !== (await artworkDedupDirectDeleteScopeDigest(tx, op.id))
  ) {
    throw new ArtworkDedupOperationError('STALE')
  }
  const review = await tx.artworkDedupReviewState.findUnique({
    where: { runId_userId: { runId: op.runId, userId: input.userId } }
  })
  if (review?.reviewRevision !== op.frozenReviewRevision || !(await validateArtworkDedupOperationSnapshot(tx, op.id))) {
    throw new ArtworkDedupOperationError('STALE')
  }
  const updated = await tx.artworkDedupOperation.update({
    where: { id: op.id },
    data: {
      mode: 'DIRECT_DELETE',
      originalAction: 'DIRECT_DELETE',
      status: 'DRAINING',
      stage: 'CLAIM',
      version: { increment: 1 },
      executionVersion: { increment: 1 },
      jobId: null,
      authorizationVersion: op.version,
      authorizationDigest: digest,
      directDeleteConfirmedAt: new Date(),
      externalWritesStoppedAt: new Date(),
      organizationConfirmedAt: new Date(),
      cancelRequestedAt: null,
      errorCode: null
    }
  })
  await remember(tx, input, 'DIRECT_DELETE', digest, updated)
  return { operation: updated, created: true }
}
export async function assertArtworkDedupDirectDeleteExecution(
  tx: Prisma.TransactionClient,
  execution: ArtworkDedupOperationExecution,
  allowControl = false
) {
  const op = await assertArtworkDedupOperationExecution(tx, execution, { allowControl })
  protocol(op)
  if (
    op.mode !== 'DIRECT_DELETE' ||
    !op.authorizationDigest ||
    !op.directDeleteConfirmedAt ||
    !op.externalWritesStoppedAt
  ) {
    throw new ArtworkDedupOperationError('DIRECT_DELETE_NOT_AUTHORIZED')
  }
  return op
}
async function lockSources(tx: Prisma.TransactionClient, op: Operation) {
  await lockCreatorCatalog(tx)
  const roots = artworkDedupBoundRoots(op.rootBindings)
  await lockContentDirectories(
    tx,
    [roots.source, roots.archive].map((root) => ({
      ...root,
      logicalRoot: root.logicalRoot as MediaContentLogicalRoot,
      relativeDirectory: ''
    }))
  )
  await tx.$queryRaw(
    Prisma.sql`SELECT count(*) FROM (SELECT s.id FROM "ArtworkDedupSourceIdentity" s WHERE s.id IN(SELECT "sourceId" FROM "ArtworkDedupOperationSource" WHERE "operationId"=${op.id}) ORDER BY s."identityKey" COLLATE "C" FOR UPDATE OF s) locked`
  )
}
/** Caller retains root/source locks across all bounded release pages. */
async function reopenHeldSources(tx: Prisma.TransactionClient, operationId: string) {
  for (;;) {
    const sources = await tx.artworkDedupSourceIdentity.findMany({
      where: { ownerOperationId: operationId, status: 'HOLD' },
      select: { id: true, generation: true },
      orderBy: { identityKey: 'asc' },
      take: 10000
    })
    if (!sources.length) return
    await reopenArtworkDedupSources(tx, {
      operationId,
      sources: sources.map((source) => ({ sourceId: source.id, expectedGeneration: source.generation }))
    })
  }
}
export async function assertArtworkDedupDirectDeleteClaims(
  tx: Prisma.TransactionClient,
  execution: ArtworkDedupOperationExecution
) {
  const op = await assertArtworkDedupDirectDeleteExecution(tx, execution)
  await lockSources(tx, op)
  if (op.protocolVersion === 3 || op.protocolVersion === 4) {
    const groups = await tx.artworkDedupOperationGroup.findMany({ where: { operationId: op.id }, take: 2 })
    const group = groups[0]
    if (groups.length !== 1 || group?.relationKind !== (op.protocolVersion === 4 ? 'PARTIAL' : 'VISUAL') || group.selectionBasis !== 'SAVED' ||
      op.keepers !== 1 || op.copies !== 1 || !group.visual) throw new ArtworkDedupOperationError('INCOMPLETE_EVIDENCE')
    const summary = group.relationKind === 'PARTIAL' ? assertArtworkDedupPartialSummary(group.visual) : assertArtworkDedupVisualSummary(group.visual)
    const members = await tx.artworkDedupOperationArtwork.findMany({ where: { operationId: op.id }, take: 3 })
    if (members.length !== 2 || !members.some(a => a.artworkId === summary.leftArtworkId && a.memberCount === summary.leftFileCount) ||
      !members.some(a => a.artworkId === summary.rightArtworkId && a.memberCount === summary.rightFileCount)) throw new ArtworkDedupOperationError('INCOMPLETE_EVIDENCE')
  } else if (await tx.artworkDedupOperationGroup.findFirst({ where: { operationId: op.id, relationKind: { in: ['VISUAL', 'PARTIAL'] } } })) {
    throw new ArtworkDedupOperationError('DIRECT_DELETE_PROTOCOL_REQUIRED')
  }
  const [bad] = await tx.$queryRaw<{ bad: boolean }[]>(Prisma.sql`SELECT
    EXISTS(SELECT 1 FROM "ArtworkDedupOperationArtwork" a LEFT JOIN "ArtworkDedupClaim" c ON c."artworkId"=a."artworkId" WHERE a."operationId"=${op.id} AND NOT coalesce(c."operationId"=a."operationId" AND c.role=a.role AND c."executionVersion"=${op.executionVersion},false))
    OR EXISTS(SELECT 1 FROM "ArtworkDedupOperationSource" b JOIN "ArtworkDedupSourceIdentity" s ON s.id=b."sourceId" WHERE b."operationId"=${op.id} AND(s.status<>'HOLD' OR s."ownerOperationId" IS DISTINCT FROM ${op.id} OR s.generation<>b."frozenGeneration")) bad`)
  if (bad?.bad) throw new ArtworkDedupOperationError('CLAIM_CONFLICT')
  if (op.scopeDigest !== (await artworkDedupDirectDeleteScopeDigest(tx, op.id))) {
    throw new ArtworkDedupOperationError('SCOPE_MISMATCH')
  }
  return op
}
/** All files of all groups must have been read in this execution; one failing group prevents the first intent. */
export async function beginArtworkDedupDirectDeleteFiles(
  tx: Prisma.TransactionClient,
  execution: ArtworkDedupOperationExecution
) {
  const op = await assertArtworkDedupDirectDeleteClaims(tx, execution)
  if (!(await inspectArtworkDedupArchiveDrain(tx, op.id)).drained) {
    throw new ArtworkDedupOperationError('SOURCE_NOT_DRAINED')
  }
  if (!(await validateArtworkDedupOperationSnapshot(tx, op.id))) throw new ArtworkDedupOperationError('STALE')
  const ownership = await refreshArtworkDedupFileOwnership(tx, { operationId: op.id, rootBindings: op.rootBindings })
  if (ownership.changedFiles) throw new ArtworkDedupOperationError('OWNERSHIP_CHANGED')
  const [bad] = await tx.$queryRaw<{ bad: boolean }[]>(Prisma.sql`SELECT EXISTS(
    SELECT 1 FROM "ArtworkDedupOperationArtwork" a WHERE a."operationId"=${op.id} AND (a."freshVerifiedExecutionVersion" IS DISTINCT FROM ${op.executionVersion} OR a."freshContentSha256" IS DISTINCT FROM a."contentSha256" OR a."freshMembersSignature" IS DISTINCT FROM a."membersSignature"))
    OR EXISTS(SELECT 1 FROM "ArtworkDedupOperationGroup" g JOIN "ArtworkDedupOperationArtwork" a ON a."operationId"=g."operationId" AND a."groupId"=g."groupId" JOIN "ArtworkDedupOperationArtwork" k ON k."operationId"=g."operationId" AND k."artworkId"=g."keeperArtworkId" WHERE g."operationId"=${op.id} AND g."relationKind"='EXACT' AND(a."contentSha256"<>k."contentSha256" OR a."memberCount"<>k."memberCount"))
    OR EXISTS(SELECT 1 FROM "ArtworkDedupOperationGroup" g
      LEFT JOIN "ArtworkDedupOperationArtwork" a ON a."operationId"=g."operationId" AND a."artworkId"=g."containedArtworkId"
      LEFT JOIN "ArtworkDedupOperationArtwork" k ON k."operationId"=g."operationId" AND k."artworkId"=g."containerArtworkId"
      WHERE g."operationId"=${op.id} AND g.status='SELECTED' AND g."relationKind"='CONTAINS' AND (
        NOT coalesce(${op.protocolVersion}=2 AND a.role='COPY' AND k.role='KEEPER' AND g."keeperArtworkId"=g."containerArtworkId"
          AND a."memberCount"=g."containedFileCount" AND k."memberCount"=g."containerFileCount" AND a."memberCount"<k."memberCount",false)
        OR EXISTS(SELECT 1 FROM "ArtworkDedupOperationFile" f WHERE f."operationId"=g."operationId" AND f."artworkId"=g."containedArtworkId" AND f.role='MEDIA'
          GROUP BY f.size,f.sha256 HAVING count(*)>(SELECT count(*) FROM "ArtworkDedupOperationFile" kept WHERE kept."operationId"=g."operationId" AND kept."artworkId"=g."containerArtworkId" AND kept.role='MEDIA' AND kept.size=f.size AND kept.sha256=f.sha256))
      )) bad`)
  if (bad?.bad) throw new ArtworkDedupOperationError('INCOMPLETE_EVIDENCE')
  if (op.preparationVersion === 2 && (op.verifiedFiles !== op.preparedFiles ||
    await tx.artworkDedupOperationArtwork.count({ where: { operationId: op.id, inspectionComplete: false } }) ||
    await tx.artworkDedupOperationFile.count({ where: { operationId: op.id, OR: [{ inspectionStatus: { not: 'VERIFIED' } }, { status: { notIn: ['VERIFIED', 'DELETE_INTENT', 'DELETED'] } }] } }))) {
    throw new ArtworkDedupOperationError('INCOMPLETE_EVIDENCE')
  }
  if (op.protocolVersion === 4) {
    const group = await tx.artworkDedupOperationGroup.findFirstOrThrow({ where: { operationId: op.id, relationKind: 'PARTIAL' } })
    await assertArtworkDedupPartialFileEvidence(tx, op.id, group.visual)
  }
  await tx.$executeRaw(
    Prisma.sql`UPDATE "Artwork" SET "deletedAt"=coalesce("deletedAt",CURRENT_TIMESTAMP) WHERE id IN(SELECT "artworkId" FROM "ArtworkDedupOperationArtwork" WHERE "operationId"=${op.id} AND role='COPY')`
  )
  await tx.artworkDedupOperationArtwork.updateMany({
    where: { operationId: op.id, role: 'COPY' },
    data: { status: 'DELETING', manifestDigest: op.scopeDigest, manifestPersistedAt: new Date() }
  })
  const observedBytes = op.preparationVersion === 2
    ? (await tx.artworkDedupOperationFile.aggregate({ where: { operationId: op.id, artwork: { role: 'COPY' } }, _sum: { size: true } }))._sum.size
    : op.logicalBytes
  return tx.artworkDedupOperation.update({
    where: { id: op.id },
    data: { status: 'DELETING', stage: 'DELETE_FILES', freshVerifiedExecutionVersion: op.executionVersion, logicalBytes: observedBytes }
  })
}
export async function retryArtworkDedupDirectDelete(
  tx: Prisma.TransactionClient,
  input: ArtworkDedupDirectDeleteCommand
) {
  const { op, prior, digest } = await command(tx, input, 'RETRY_DIRECT_DELETE')
  if (prior) return { operation: op, created: false }
  if (
    op.mode !== 'DIRECT_DELETE' ||
    !['RECOVERY_REQUIRED', 'STOPPED', 'FAILED'].includes(op.status) ||
    op.readerToken ||
    op.readerState !== 'IDLE'
  ) {
    throw new ArtworkDedupOperationError('READER_BLOCKED')
  }
  const job = op.jobId ? await tx.systemJob.findUnique({ where: { id: op.jobId }, select: { status: true } }) : null
  if (job && !['FAILED', 'CANCELLED', 'COMPLETED', 'PAUSED'].includes(job.status)) {
    throw new ArtworkDedupOperationError('EXECUTION_ACTIVE')
  }
  await lockSources(tx, op)
  const updated = await tx.artworkDedupOperation.update({
    where: { id: op.id },
    data: {
      status: 'DRAINING',
      stage: 'CLAIM',
      executionVersion: { increment: 1 },
      version: { increment: 1 },
      jobId: null,
      cancelRequestedAt: null,
      errorCode: null
    }
  })
  await tx.artworkDedupClaim.updateMany({
    where: { operationId: op.id, executionVersion: op.executionVersion },
    data: { executionVersion: updated.executionVersion }
  })
  await remember(tx, input, 'RETRY_DIRECT_DELETE', digest, updated)
  return { operation: updated, created: true }
}
export async function requestArtworkDedupDirectDeleteStop(
  tx: Prisma.TransactionClient,
  input: ArtworkDedupDirectDeleteCommand
) {
  const { op, prior, digest } = await command(tx, input, 'STOP_DIRECT_DELETE')
  if (prior) return op
  if (op.mode !== 'DIRECT_DELETE' || ['DELETED', 'CANCELLED'].includes(op.status)) {
    throw new ArtworkDedupOperationError('INVALID_STATE')
  }
  const job = op.jobId ? await tx.systemJob.findUnique({ where: { id: op.jobId }, select: { status: true } }) : null
  const schedule =
    !op.readerToken &&
    op.readerState === 'IDLE' &&
    (!job || ['FAILED', 'CANCELLED', 'COMPLETED', 'PAUSED'].includes(job.status))
  const updated = await tx.artworkDedupOperation.update({
    where: { id: op.id },
    data: {
      cancelRequestedAt: new Date(),
      version: { increment: 1 },
      ...(schedule ? { jobId: null, executionVersion: { increment: 1 }, status: 'DRAINING', stage: 'DRAIN' } : {})
    }
  })
  if (schedule) {
    await tx.artworkDedupClaim.updateMany({
      where: { operationId: op.id, executionVersion: op.executionVersion },
      data: { executionVersion: updated.executionVersion }
    })
  }
  return remember(tx, input, 'STOP_DIRECT_DELETE', digest, updated)
}
/** Called only after actual reader close, under the original runtime fence. */
export async function finishArtworkDedupDirectDeleteStop(
  tx: Prisma.TransactionClient,
  execution: ArtworkDedupOperationExecution
) {
  const op = await assertArtworkDedupDirectDeleteExecution(tx, execution, true)
  if (op.readerToken || op.readerState !== 'IDLE') throw new ArtworkDedupOperationError('READER_BLOCKED')
  const intents = await tx.artworkDedupFileReceipt.count({ where: { operationId: op.id, step: 'DELETE' } })
  if (intents || op.deleteStartedAt) {
    return tx.artworkDedupOperation.update({ where: { id: op.id }, data: { status: 'STOPPED', stage: 'STOPPED' } })
  }
  if (!(await tx.artworkDedupClaim.count({ where: { operationId: op.id } }))) {
    return tx.artworkDedupOperation.update({ where: { id: op.id }, data: { status: 'CANCELLED', stage: 'DONE' } })
  }
  await lockSources(tx, op)
  if (!(await inspectArtworkDedupArchiveDrain(tx, op.id)).drained) {
    throw new ArtworkDedupOperationError('SOURCE_NOT_DRAINED')
  }
  await reopenHeldSources(tx, op.id)
  await tx.$executeRaw(
    Prisma.sql`UPDATE "Artwork" SET "deletedAt"=NULL WHERE id IN(SELECT "artworkId" FROM "ArtworkDedupOperationArtwork" WHERE "operationId"=${op.id} AND role='COPY' AND status='DELETING')`
  )
  await tx.artworkDedupClaim.deleteMany({ where: { operationId: op.id } })
  return tx.artworkDedupOperation.update({
    where: { id: op.id },
    data: { status: 'CANCELLED', stage: 'DONE', freshVerifiedExecutionVersion: null }
  })
}
/** Files, not queue success, authorize business deletion. All rows/logs are independent of Artwork FKs. */
export async function finalizeArtworkDedupDirectDelete(
  tx: Prisma.TransactionClient,
  execution: ArtworkDedupOperationExecution
) {
  const op = await assertArtworkDedupDirectDeleteClaims(tx, execution)
  if (
    op.readerToken ||
    op.readerState !== 'IDLE' ||
    op.status !== 'DELETING' ||
    op.freshVerifiedExecutionVersion !== op.executionVersion
  ) {
    throw new ArtworkDedupOperationError('INVALID_STATE')
  }
  if (!(await inspectArtworkDedupArchiveDrain(tx, op.id)).drained) {
    throw new ArtworkDedupOperationError('SOURCE_NOT_DRAINED')
  }
  if (!(await validateArtworkDedupOperationSnapshot(tx, op.id))) throw new ArtworkDedupOperationError('STALE')
  const [missing] = await tx.$queryRaw<{ n: bigint }[]>(
    Prisma.sql`SELECT count(*) n FROM "ArtworkDedupOperationFile" f JOIN "ArtworkDedupOperationArtwork" a USING("operationId","artworkId") WHERE f."operationId"=${op.id} AND a.role='COPY' AND(f.status<>'DELETED' OR NOT EXISTS(SELECT 1 FROM "ArtworkDedupFileReceipt" r WHERE r."fileId"=f."fileId" AND r."operationId"=f."operationId" AND r.step='DELETE' AND r.status='COMPLETED'))`
  )
  if (missing?.n) throw new ArtworkDedupOperationError('INCOMPLETE_RECEIPTS')
  const copies = await tx.artworkDedupOperationArtwork.findMany({
    where: { operationId: op.id, role: 'COPY' },
    select: { artworkId: true }
  })
  const ids = copies.map((a) => a.artworkId)
  await tx.$executeRaw(
    Prisma.sql`UPDATE "ArtworkDedupSourceIdentity" s SET status='TOMBSTONE',"updatedAt"=CURRENT_TIMESTAMP WHERE s."ownerOperationId"=${op.id} AND s.status='HOLD' AND EXISTS(SELECT 1 FROM "ArtworkDedupOperationSource" b JOIN "ArtworkDedupOperationArtwork" a ON a."operationId"=b."operationId" AND a."artworkId"=b."artworkId" WHERE b."operationId"=${op.id} AND b."sourceId"=s.id AND a.role='COPY')`
  )
  await reopenHeldSources(tx, op.id)
  await tx.image.deleteMany({ where: { artworkId: { in: ids } } })
  await tx.mediaMark.deleteMany({ where: { artworkId: { in: ids } } })
  await tx.artwork.deleteMany({ where: { id: { in: ids }, deletedAt: { not: null }, archiveLifecycleState: 'ACTIVE' } })
  if (await tx.artwork.count({ where: { id: { in: ids } } })) throw new ArtworkDedupOperationError('STALE')
  await tx.artworkDedupOperationArtwork.updateMany({
    where: { operationId: op.id, role: 'COPY' },
    data: { status: 'DELETED' }
  })
  await tx.artworkDedupClaim.deleteMany({ where: { operationId: op.id } })
  return tx.artworkDedupOperation.update({
    where: { id: op.id },
    data: { status: 'DELETED', stage: 'DONE', version: { increment: 1 } }
  })
}
export async function allowArtworkDedupDirectDeleteReimport(
  tx: Prisma.TransactionClient,
  input: ArtworkDedupDirectDeleteCommand & { sources: { sourceId: string; expectedGeneration: bigint }[] }
) {
  const canonical = {
    ...input,
    sources: [...input.sources]
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
      .map((s) => ({ ...s, expectedGeneration: s.expectedGeneration.toString() }))
  }
  const { op, prior, digest } = await command(tx, input, 'ALLOW_DIRECT_DELETE_REIMPORT', canonical)
  if (prior) return op
  if (op.status !== 'DELETED' || op.readerToken || op.readerState !== 'IDLE') {
    throw new ArtworkDedupOperationError('INVALID_STATE')
  }
  await lockSources(tx, op)
  for (const source of input.sources) {
    const binding = await tx.artworkDedupOperationSource.findFirst({
      where: { operationId: op.id, sourceId: source.sourceId }
    })
    const item = binding
      ? await tx.artworkDedupOperationArtwork.findUnique({
          where: { operationId_artworkId: { operationId: op.id, artworkId: binding.artworkId } }
        })
      : null
    const current = await tx.artworkDedupSourceIdentity.findUnique({ where: { id: source.sourceId } })
    if (item?.role !== 'COPY' || item.status !== 'DELETED' || current?.status !== 'TOMBSTONE') {
      throw new ArtworkDedupOperationError('SCOPE_MISMATCH')
    }
  }
  await reopenArtworkDedupSources(tx, { operationId: op.id, sources: input.sources })
  const updated = await tx.artworkDedupOperation.update({ where: { id: op.id }, data: { version: { increment: 1 } } })
  return remember(tx, input, 'ALLOW_DIRECT_DELETE_REIMPORT', digest, updated)
}
