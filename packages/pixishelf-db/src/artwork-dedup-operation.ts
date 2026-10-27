import { randomUUID } from 'node:crypto'
import { refreshArtworkDedupFileOwnership } from './artwork-dedup-ownership'
import { Prisma } from '@prisma/client'
import { ArtworkDedupConflictError, type ArtworkDedupReaderOwner } from './artwork-dedup'

export interface ArtworkDedupOperationExecution {
  operationId: string
  jobId: string
  executionVersion: number
}
export class ArtworkDedupOperationError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'ArtworkDedupOperationError'
  }
}
export function artworkDedupPageLimit(value: number | undefined, maximum: number) {
  const size = value ?? maximum
  if (!Number.isSafeInteger(size) || size < 1 || size > maximum) throw new RangeError('Invalid maintenance page size')
  return size
}
export async function lockArtworkDedupOperation(tx: Prisma.TransactionClient, operationId: string) {
  const before = await tx.artworkDedupOperation.findUnique({ where: { id: operationId }, select: { runId: true } })
  if (!before) throw new ArtworkDedupOperationError('NOT_FOUND')
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ArtworkDedupRun" WHERE id=${before.runId} FOR UPDATE`)
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "ArtworkDedupOperation" WHERE id=${operationId} FOR UPDATE`)
  return tx.artworkDedupOperation.findUniqueOrThrow({ where: { id: operationId } })
}
/** Domain identity check; callers must also use the existing runtime execution fence. */
export async function assertArtworkDedupOperationExecution(
  tx: Prisma.TransactionClient,
  execution: ArtworkDedupOperationExecution,
  options: { allowControl?: boolean } = {}
) {
  const op = await lockArtworkDedupOperation(tx, execution.operationId)
  if (op.jobId !== execution.jobId || op.executionVersion !== execution.executionVersion)
    throw new ArtworkDedupOperationError('STALE_EXECUTION')
  const job = await tx.systemJob.findUnique({
    where: { id: execution.jobId },
    select: { type: true, status: true, payload: true, definitionVersion: true }
  })
  const payload = job?.payload as Record<string, unknown> | undefined
  if (
    job?.type !== 'ARTWORK_DEDUP_MAINTENANCE' ||
    (op.protocolVersion === 3 && ![4, 5].includes(job.definitionVersion)) ||
    (op.protocolVersion === 4 && (job.definitionVersion !== 5 || op.mode === 'PREPARE' && payload?.protocolVersion !== 4)) ||
    !(options.allowControl ? ['RUNNING', 'PAUSING', 'CANCELLING'] : ['RUNNING']).includes(job.status) ||
    payload?.operationId !== op.id ||
    payload?.executionVersion !== op.executionVersion ||
    payload?.mode !== op.mode
  )
    throw new ArtworkDedupOperationError('STALE_EXECUTION')
  if (op.cancelRequestedAt && !options.allowControl) throw new ArtworkDedupOperationError('CANCEL_REQUESTED')
  return op
}
export async function readArtworkDedupOperationArtworksPage(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupOperationExecution; afterArtworkId?: number; limit?: number; statuses?: string[] }
) {
  await assertArtworkDedupOperationExecution(tx, input.execution)
  return tx.artworkDedupOperationArtwork.findMany({
    where: {
      operationId: input.execution.operationId,
      artworkId: { gt: input.afterArtworkId ?? 0 },
      ...(input.statuses ? { status: { in: input.statuses } } : {})
    },
    orderBy: { artworkId: 'asc' },
    take: artworkDedupPageLimit(input.limit, 100)
  })
}
export async function readArtworkDedupOperationFilesPage(
  tx: Prisma.TransactionClient,
  input: {
    execution: ArtworkDedupOperationExecution
    artworkId?: number
    afterFileId?: string
    limit?: number
    statuses?: string[]
  }
) {
  await assertArtworkDedupOperationExecution(tx, input.execution)
  return tx.artworkDedupOperationFile.findMany({
    where: {
      operationId: input.execution.operationId,
      ...(input.artworkId !== undefined ? { artworkId: input.artworkId } : {}),
      ...(input.afterFileId ? { fileId: { gt: input.afterFileId } } : {}),
      ...(input.statuses ? { status: { in: input.statuses } } : {})
    },
    orderBy: { fileId: 'asc' },
    take: artworkDedupPageLimit(input.limit, 500)
  })
}
export type ArtworkDedupOperationCheckpoint = Pick<
  Prisma.ArtworkDedupOperationUpdateInput,
  | 'stage'
  | 'afterArtworkId'
  | 'afterImageId'
  | 'afterFileId'
  | 'preparedArtworks'
  | 'preparedFiles'
  | 'logicalBytes'
  | 'blockedGroups'
  | 'movedFiles'
  | 'restoredFiles'
  | 'deletedFiles'
  | 'lastProgressAt'
  | 'errorCode'
  | 'rootBindings'
>
export async function updateArtworkDedupOperationCheckpoint(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupOperationExecution; data: ArtworkDedupOperationCheckpoint; allowControl?: boolean }
) {
  await assertArtworkDedupOperationExecution(tx, input.execution, { allowControl: input.allowControl ?? false })
  return tx.artworkDedupOperation.update({ where: { id: input.execution.operationId }, data: input.data })
}
export type ArtworkDedupOperationArtworkCheckpoint = Pick<
  Prisma.ArtworkDedupOperationArtworkUpdateManyMutationInput,
  | 'status'
  | 'afterImageId'
  | 'afterFileId'
  | 'inventoryComplete'
  | 'inspectionComplete'
  | 'inspectionCheckpoint'
  | 'fileCount'
  | 'errorCode'
>
export async function updateArtworkDedupOperationArtwork(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupOperationExecution; artworkId: number; data: ArtworkDedupOperationArtworkCheckpoint }
) {
  await assertArtworkDedupOperationExecution(tx, input.execution)
  return tx.artworkDedupOperationArtwork.update({
    where: { operationId_artworkId: { operationId: input.execution.operationId, artworkId: input.artworkId } },
    data: input.data
  })
}
export type ArtworkDedupOperationFileInput = Omit<
  Prisma.ArtworkDedupOperationFileUncheckedCreateInput,
  'operationId' | 'fileId' | 'version' | 'receipts'
>
function relativePath(value: string) {
  if (
    !value ||
    value.includes('\0') ||
    /^[\\/]|^[A-Za-z]:/.test(value) ||
    value.split(/[\\/]/).some((part) => part === '..')
  )
    throw new ArtworkDedupOperationError('UNSAFE_PATH')
}
export async function saveArtworkDedupOperationFilesPage(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupOperationExecution; entries: ArtworkDedupOperationFileInput[] }
) {
  const op = await assertArtworkDedupOperationExecution(tx, input.execution)
  if (op.mode !== 'PREPARE' || !['ISOLATION', 'DIRECT_DELETE'].includes(op.preparePurpose)) throw new ArtworkDedupOperationError('INVALID_STATE')
  if (input.entries.length === 0) return
  artworkDedupPageLimit(input.entries.length, 100)
  const ids = [...new Set(input.entries.map((entry) => entry.artworkId))]
  if (
    (await tx.artworkDedupOperationArtwork.count({ where: { operationId: op.id, artworkId: { in: ids } } })) !==
    ids.length
  )
    throw new ArtworkDedupOperationError('SCOPE_MISMATCH')
  for (const entry of input.entries) {
    relativePath(entry.canonicalPath)
    if (entry.isolationRelativePath) relativePath(entry.isolationRelativePath)
    if (entry.role === 'ATTACHMENT' || entry.role === 'UNKNOWN') {
      if (!entry.requiresReview || entry.status !== 'BLOCKED')
        throw new ArtworkDedupOperationError('UNREVIEWED_ATTACHMENT')
    }
    const prior = await tx.artworkDedupOperationFile.findUnique({
      where: { operationId_referenceKey: { operationId: op.id, referenceKey: entry.referenceKey } }
    })
    if (
      prior &&
      (prior.artworkId !== entry.artworkId ||
        prior.role !== entry.role ||
        prior.canonicalPath !== entry.canonicalPath ||
        prior.rootIdentity !== entry.rootIdentity)
    )
      throw new ArtworkDedupOperationError('STALE')
    await tx.artworkDedupOperationFile.upsert({
      where: { operationId_referenceKey: { operationId: op.id, referenceKey: entry.referenceKey } },
      create: { ...entry, operationId: op.id, ownershipStatus: 'UNCONFIRMED' },
      update: { ...entry, ownershipStatus: 'UNCONFIRMED' }
    })
  }
  await refreshArtworkDedupFileOwnership(tx, {
    operationId: op.id,
    rootBindings: op.rootBindings,
    referenceKeys: input.entries.map((entry) => entry.referenceKey)
  })
}
export interface ArtworkDedupInventoryReference {
  referenceKey: string
  role: 'SOURCE_FILE'
  rootKind: 'SOURCE' | 'ARCHIVE'
  path: string
  revisionId: string | null
  expectedIdentity:
    | { kind: 'PIXIV_METADATA'; externalId: string; format: 'json' | 'txt' }
    | { kind: 'ARCHIVE_MANIFEST'; revisionId: string; providerKey: string; externalId: string }
}
export async function readArtworkDedupInventoryPage(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupOperationExecution; artworkId: number; afterImageId?: number; limit?: number }
) {
  const op = await assertArtworkDedupOperationExecution(tx, input.execution)
  const frozen = await tx.artworkDedupOperationArtwork.findUnique({
    where: { operationId_artworkId: { operationId: op.id, artworkId: input.artworkId } }
  })
  if (!frozen) throw new ArtworkDedupOperationError('SCOPE_MISMATCH')
  const artwork = await tx.artwork.findUnique({
    where: { id: input.artworkId },
    include: {
      contentSource: true,
      archiveRevisions: {
        take: 2,
        orderBy: { id: 'asc' },
        include: {
          externalRef: { select: { providerKey: true, externalId: true } },
          archiveImport: { select: { sealedManifestSha256: true } }
        }
      }
    }
  })
  if (
    !artwork ||
    artwork.deletedAt ||
    artwork.archiveLifecycleState !== 'ACTIVE' ||
    artwork.mediaRevision !== frozen.frozenMediaRevision ||
    (artwork.contentSource?.revision ?? 0n) !== frozen.snapshotRevision ||
    (artwork.contentSource?.mediaEpoch ?? 0n) !== frozen.mediaEpoch ||
    artwork.contentSource?.writeToken
  )
    throw new ArtworkDedupOperationError('STALE')
  const size = artworkDedupPageLimit(input.limit, 500)
  const rows = await tx.image.findMany({
    where: { artworkId: artwork.id, id: { gt: input.afterImageId ?? 0 } },
    select: { id: true, path: true, size: true, chaptersPath: true, chaptersHash: true, chaptersUpdatedAt: true },
    orderBy: { id: 'asc' },
    take: size + 1
  })
  const images = rows.slice(0, size)
  const evidence = await tx.artworkDedupMedia.findMany({
    where: { runId: op.runId, artworkId: artwork.id, imageId: { in: images.map((row) => row.id) } }
  })
  const evidenceById = new Map(evidence.map((row) => [row.imageId, row]))
  const revision =
    artwork.createdVia === 'URL_ARCHIVE' &&
    artwork.archiveRevisions.length === 1 &&
    artwork.archiveRevisions[0]?.isCurrent
      ? artwork.archiveRevisions[0]
      : null
  const archivePrefix = revision ? `${revision.archivePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}/` : null
  const stagedPaths = archivePrefix
    ? images
        .map((row) => row.path.replace(/\\/g, '/').replace(/^\/+/, ''))
        .filter((path) => path.startsWith(archivePrefix))
        .map((path) => path.slice(archivePrefix.length))
    : []
  const archiveItems =
    revision?.archiveImportId && stagedPaths.length
      ? await tx.archiveImportItem.findMany({
          where: { archiveImportId: revision.archiveImportId, stagedPath: { in: stagedPaths } },
          select: { pageIndex: true, stagedPath: true, sha256: true, byteCount: true, status: true },
          take: size + 1
        })
      : []
  const archiveByPath = new Map(archiveItems.map((row) => [row.stagedPath, row]))

  const sourceReferences: ArtworkDedupInventoryReference[] = []
  const blockReasons: string[] = []
  if (
    revision &&
    (archiveItems.length !== images.length ||
      archiveByPath.size !== archiveItems.length ||
      archiveItems.some((row) => row.status !== 'COMPLETED' || !row.sha256 || row.byteCount === null))
  )
    blockReasons.push('ARCHIVE_MANIFEST_UNVERIFIED')
  if (artwork.metaSource) {
    const match = artwork.metaSource
      .split('/')
      .at(-1)
      ?.match(/^(\d+)(?:_p\d+)?-meta\.(json|txt)$/i)
    if (artwork.createdVia === 'PIXIV_SCAN' && artwork.externalId && match?.[1] === artwork.externalId)
      sourceReferences.push({
        referenceKey: `meta:${artwork.id}`,
        role: 'SOURCE_FILE',
        rootKind: 'SOURCE',
        path: artwork.metaSource,
        revisionId: null,
        expectedIdentity: {
          kind: 'PIXIV_METADATA',
          externalId: artwork.externalId,
          format: match[2]!.toLowerCase() as 'json' | 'txt'
        }
      })
    else blockReasons.push('UNVERIFIED_SOURCE_IDENTITY')
  }
  if (artwork.createdVia === 'URL_ARCHIVE') {
    if (artwork.archiveRevisions.length !== 1 || !artwork.archiveRevisions[0]?.isCurrent)
      blockReasons.push('UNREVIEWED_ARCHIVE_REVISIONS')
    else {
      const revision = artwork.archiveRevisions[0]
      sourceReferences.push({
        referenceKey: `revision:${revision.id}:manifest`,
        role: 'SOURCE_FILE',
        rootKind: 'ARCHIVE',
        path: revision.manifestPath,
        revisionId: revision.id,
        expectedIdentity: {
          kind: 'ARCHIVE_MANIFEST',
          revisionId: revision.id,
          providerKey: revision.externalRef.providerKey,
          externalId: revision.externalRef.externalId
        }
      })
    }
  }
  let exclusiveDirectory: { path: string; proof: 'REGISTERED_EXCLUSIVE' } | null = null
  if (artwork.storagePath && artwork.storageKey && ['LOCAL_DIRECTORY', 'MANUAL_CREATE'].includes(artwork.createdVia)) {
    const dir = artwork.storagePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const shared = await tx.image.count({
      where: { OR: [{ artworkId: null }, { artworkId: { not: artwork.id } }], path: { startsWith: `${dir}/` } }
    })
    const others = await tx.artwork.count({
      where: {
        id: { not: artwork.id },
        OR: [
          { storagePath: dir },
          { storagePath: { startsWith: `${dir}/` } },
          { metaSource: { startsWith: `${dir}/` } }
        ]
      }
    })
    if (!shared && !others) exclusiveDirectory = { path: dir, proof: 'REGISTERED_EXCLUSIVE' }
    else blockReasons.push('SHARED_PATH')
  }
  if (op.preparePurpose === 'DIRECT_DELETE' && revision) exclusiveDirectory = {path: revision.archivePath, proof: 'REGISTERED_EXCLUSIVE'}
  return {
    artwork: frozen,
    images: images.map((row) => ({
      ...row,
      evidence: evidenceById.get(row.id) ?? null,
      archiveItem: archivePrefix
        ? (archiveByPath.get(row.path.replace(/\\/g, '/').replace(/^\/+/, '').slice(archivePrefix.length)) ?? null)
        : null
    })),
    nextImageId: rows.length > size ? images.at(-1)!.id : null,
    sourceReferences,
    exclusiveDirectory,
    blockReasons
  }
}
export async function getArtworkDedupAnyReaderLatch(tx: Prisma.TransactionClient) {
  const select = {
    id: true,
    jobId: true,
    executionVersion: true,
    readerToken: true,
    readerState: true,
    readerOwner: true
  } as const
  const run = await tx.artworkDedupRun.findFirst({ where: { readerToken: { not: null } }, select })
  if (run) return { ...run, kind: 'SCAN' as const }
  const op = await tx.artworkDedupOperation.findFirst({ where: { readerToken: { not: null } }, select })
  return op ? { ...op, kind: 'MAINTENANCE' as const } : null
}
export async function claimArtworkDedupOperationReader(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupOperationExecution; readerToken: string }
) {
  await assertArtworkDedupOperationExecution(tx, input.execution)
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(8043203001)::text`
  if (await getArtworkDedupAnyReaderLatch(tx)) throw new ArtworkDedupConflictError('READER_BLOCKED')
  await tx.artworkDedupOperation.update({
    where: { id: input.execution.operationId },
    data: { readerToken: input.readerToken, readerState: 'STARTING' }
  })
}
export async function recordArtworkDedupOperationReaderOwner(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupOperationExecution; readerToken: string; owner: ArtworkDedupReaderOwner }
) {
  const op = await assertArtworkDedupOperationExecution(tx, input.execution)
  if (op.readerToken !== input.readerToken || op.readerState !== 'STARTING')
    throw new ArtworkDedupOperationError('STALE_READER')
  await tx.artworkDedupOperation.update({
    where: { id: op.id },
    data: { readerState: 'ACTIVE', readerOwner: { ...input.owner } }
  })
}
export async function releaseArtworkDedupOperationReader(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupOperationExecution; readerToken: string; blocked?: boolean }
) {
  const op = await lockArtworkDedupOperation(tx, input.execution.operationId)
  if (
    op.jobId !== input.execution.jobId ||
    op.executionVersion !== input.execution.executionVersion ||
    op.readerToken !== input.readerToken
  )
    throw new ArtworkDedupOperationError('STALE_READER')
  await tx.artworkDedupOperation.update({
    where: { id: op.id },
    data: input.blocked
      ? { readerState: 'BLOCKED' }
      : { readerState: 'IDLE', readerToken: null, readerOwner: Prisma.DbNull }
  })
}
export async function beginArtworkDedupFileStep(
  tx: Prisma.TransactionClient,
  input: {
    execution: ArtworkDedupOperationExecution
    fileId: string
    step: 'MOVE' | 'RESTORE' | 'DELETE'
    expectedFileVersion: number
  }
) {
  const op = await assertArtworkDedupOperationExecution(tx, input.execution)
  const mode = { MOVE: 'ISOLATE', RESTORE: 'RESTORE', DELETE: 'PURGE' }[input.step]
  const direct = input.step === 'DELETE' && op.mode === 'DIRECT_DELETE'
  if (direct && (op.preparePurpose !== 'DIRECT_DELETE' || ![1, 2, 3, 4].includes(op.protocolVersion ?? 0) || !op.directDeleteConfirmedAt || !op.authorizationDigest || op.status !== 'DELETING' || op.freshVerifiedExecutionVersion !== op.executionVersion)) throw new ArtworkDedupOperationError('DIRECT_DELETE_NOT_AUTHORIZED')
  if (op.mode !== mode && !direct) throw new ArtworkDedupOperationError('INVALID_STATE')
  const file = await tx.artworkDedupOperationFile.findUnique({ where: { fileId: input.fileId } })
  if (!file || file.operationId !== op.id || file.version !== input.expectedFileVersion)
    throw new ArtworkDedupOperationError('STALE_FILE')
  const artwork = await tx.artworkDedupOperationArtwork.findUniqueOrThrow({
    where: { operationId_artworkId: { operationId: op.id, artworkId: file.artworkId } }
  })
  if (direct) {
    const claim = await tx.artworkDedupClaim.findUnique({where:{artworkId:file.artworkId}})
    if (claim?.operationId !== op.id || claim.executionVersion !== op.executionVersion || claim.role !== 'COPY') throw new ArtworkDedupOperationError('CLAIM_CONFLICT')
  }
  if (artwork.role !== 'COPY' || !artwork.selectedForAction || file.requiresReview || file.blockReason)
    throw new ArtworkDedupOperationError('SCOPE_MISMATCH')
  if (
    input.step === 'MOVE' &&
    (!artwork.manifestPersistedAt || artwork.freshVerifiedExecutionVersion !== op.executionVersion)
  )
    throw new ArtworkDedupOperationError('INCOMPLETE_EVIDENCE')
  if (input.step === 'DELETE' && !direct && (!op.purgeConfirmedAt || !op.authorizationDigest))
    throw new ArtworkDedupOperationError('PURGE_NOT_AUTHORIZED')
  const key = { operationId: op.id, fileId: file.fileId, executionVersion: op.executionVersion, step: input.step }
  const prior = await tx.artworkDedupFileReceipt.findUnique({
    where: { operationId_fileId_executionVersion_step: key }
  })
  if (prior) return { file, receipt: prior, replayIntent: direct }
  const validStates =
    input.step === 'MOVE'
      ? ['VERIFIED', 'MOVE_INTENT']
      : input.step === 'RESTORE'
        ? ['MOVED', 'RESTORE_INTENT', 'MOVE_INTENT']
        : direct ? ['VERIFIED', 'DELETE_INTENT'] : ['MOVED', 'DELETE_INTENT']
  if (!validStates.includes(file.status)) throw new ArtworkDedupOperationError('INVALID_FILE_STATE')
  const replayIntent = direct && file.status === 'DELETE_INTENT'
  if (replayIntent && !await tx.artworkDedupFileReceipt.findFirst({where:{operationId:op.id,fileId:file.fileId,step:'DELETE',status:'INTENT'}})) throw new ArtworkDedupOperationError('INVALID_RECEIPT')
  if (direct && !op.deleteStartedAt) await tx.artworkDedupOperation.update({where:{id:op.id},data:{deleteStartedAt:new Date()}})
  const receipt = await tx.artworkDedupFileReceipt.create({
    data: { id: randomUUID(), ...key, expectedFileVersion: file.version }
  })
  const updated = await tx.artworkDedupOperationFile.update({
    where: { fileId: file.fileId },
    data: { status: `${input.step}_INTENT` }
  })
  return { file: updated, receipt, replayIntent }
}
export interface ArtworkDedupFileStepReceipt {
  location: 'ORIGINAL' | 'ISOLATED' | 'ABSENT'
  directoriesSynced: true
  observedSize?: string
  observedDeviceId?: string
  observedInode?: string
  observedMtimeNs?: string
  observedCtimeNs?: string
  sha256?: string
}
export async function finishArtworkDedupFileStep(
  tx: Prisma.TransactionClient,
  input: {
    execution: ArtworkDedupOperationExecution
    fileId: string
    step: 'MOVE' | 'RESTORE' | 'DELETE'
    expectedFileVersion: number
    receipt: ArtworkDedupFileStepReceipt
  }
) {
  const op = await assertArtworkDedupOperationExecution(tx, input.execution, {allowControl: true})
  const key = { operationId: op.id, fileId: input.fileId, executionVersion: op.executionVersion, step: input.step }
  const prior = await tx.artworkDedupFileReceipt.findUnique({
    where: { operationId_fileId_executionVersion_step: key }
  })
  if (
    !prior ||
    prior.expectedFileVersion !== input.expectedFileVersion ||
    input.receipt.directoriesSynced !== true ||
    input.receipt.location !== { MOVE: 'ISOLATED', RESTORE: 'ORIGINAL', DELETE: 'ABSENT' }[input.step]
  )
    throw new ArtworkDedupOperationError('INVALID_RECEIPT')
  if (prior.status === 'COMPLETED')
    return tx.artworkDedupOperationFile.findUniqueOrThrow({ where: { fileId: input.fileId } })
  const changed = await tx.artworkDedupOperationFile.updateMany({
    where: {
      fileId: input.fileId,
      operationId: op.id,
      version: input.expectedFileVersion,
      status: `${input.step}_INTENT`
    },
    data: { status: { MOVE: 'MOVED', RESTORE: 'RESTORED', DELETE: 'DELETED' }[input.step], version: { increment: 1 } }
  })
  if (changed.count !== 1) throw new ArtworkDedupOperationError('STALE_FILE')
  await tx.artworkDedupFileReceipt.update({
    where: { id: prior.id },
    data: { status: 'COMPLETED', completedAt: new Date(), receipt: { ...input.receipt } }
  })
  if(op.mode==='DIRECT_DELETE' && input.step==='DELETE') await tx.artworkDedupFileReceipt.updateMany({where:{operationId:op.id,fileId:input.fileId,step:'DELETE',status:'INTENT',expectedFileVersion:input.expectedFileVersion},data:{status:'COMPLETED',completedAt:new Date(),receipt:{...input.receipt,reconciledByExecutionVersion:op.executionVersion}}})
  return tx.artworkDedupOperationFile.findUniqueOrThrow({ where: { fileId: input.fileId } })
}
export async function recordArtworkDedupFreshEvidence(
  tx: Prisma.TransactionClient,
  input: {
    execution: ArtworkDedupOperationExecution
    artworkId: number
    contentSha256: string
    membersSignature: string
  }
) {
  const op = await assertArtworkDedupOperationExecution(tx, input.execution)
  const item = await tx.artworkDedupOperationArtwork.findUniqueOrThrow({
    where: { operationId_artworkId: { operationId: op.id, artworkId: input.artworkId } }
  })
  if (item.contentSha256 !== input.contentSha256 || item.membersSignature !== input.membersSignature)
    throw new ArtworkDedupOperationError('CONTENT_CHANGED')
  return tx.artworkDedupOperationArtwork.update({
    where: { operationId_artworkId: { operationId: op.id, artworkId: item.artworkId } },
    data: {
      freshContentSha256: input.contentSha256,
      freshMembersSignature: input.membersSignature,
      freshVerifiedExecutionVersion: op.executionVersion,
      freshVerifiedAt: new Date()
    }
  })
}
export async function recordArtworkDedupManifest(
  tx: Prisma.TransactionClient,
  input: {
    execution: ArtworkDedupOperationExecution
    artworkId: number
    manifestDigest: string
    directoriesSynced: true
  }
) {
  const op = await assertArtworkDedupOperationExecution(tx, input.execution)
  if (op.mode !== 'ISOLATE' || !/^[a-f0-9]{64}$/.test(input.manifestDigest) || input.directoriesSynced !== true)
    throw new ArtworkDedupOperationError('INVALID_MANIFEST')
  return tx.artworkDedupOperationArtwork.update({
    where: { operationId_artworkId: { operationId: op.id, artworkId: input.artworkId } },
    data: { manifestDigest: input.manifestDigest, manifestPersistedAt: new Date() }
  })
}

/** A sealed publication proves the entire manifest; do not reread/deserialize it for each media page. */
export async function readArtworkDedupArchiveManifestEvidence(
  tx: Prisma.TransactionClient,
  input: { execution: ArtworkDedupOperationExecution; artworkId: number }
) {
  const op = await assertArtworkDedupOperationExecution(tx, input.execution)
  const item = await tx.artworkDedupOperationArtwork.findUnique({
    where: { operationId_artworkId: { operationId: op.id, artworkId: input.artworkId } }
  })
  if (!item?.isUrl) throw new ArtworkDedupOperationError('SCOPE_MISMATCH')
  const rows = await tx.$queryRaw<
    { revisionId: string; providerKey: string; externalId: string; sealedManifestSha256: string; memberCount: bigint }[]
  >(Prisma.sql`
    WITH candidate AS MATERIALIZED (
      SELECT r.id "revisionId",r."archivePath",a.id "archiveImportId",a."providerKey",a."externalId",a."sealedManifestSha256"
      FROM archive_revisions r JOIN archive_imports a ON a.id=r."archiveImportId"
      JOIN archive_staging_generations g ON g.token=a."generationToken" JOIN artwork_external_refs x ON x.id=r."externalRefId"
      WHERE r."artworkId"=${item.artworkId} AND r."isCurrent" AND r."trashPath" IS NULL
        AND a."publishedArtworkId"=${item.artworkId} AND a.status='COMPLETED' AND a."externalRefId"=x.id AND a."providerKey"=x."providerKey" AND a."externalId"=x."externalId"
        AND a."sealedManifestSha256" ~ '^[a-f0-9]{64}$' AND g."archiveImportId"=a.id AND g."manifestSha256"=a."sealedManifestSha256" AND g."sealedAt" IS NOT NULL AND g."drainedAt" IS NOT NULL
        AND (SELECT count(*) FROM archive_revisions q WHERE q."artworkId"=${item.artworkId})=1
    ), mapping AS MATERIALIZED (
      SELECT q.id "itemId",i.id "imageId",q.status='COMPLETED' AND q."sha256" IS NOT NULL AND q."byteCount" IS NOT NULL
        AND i.size=q."byteCount" AND d.size=q."byteCount" AND d.sha256=q.sha256 valid
      FROM candidate c JOIN archive_import_items q ON q."archiveImportId"=c."archiveImportId"
      LEFT JOIN "Image" i ON i."artworkId"=${item.artworkId} AND ltrim(replace(i.path,chr(92),'/'),'/')=ltrim(replace(c."archivePath"||'/'||q."stagedPath",chr(92),'/'),'/')
      LEFT JOIN "ArtworkDedupMedia" d ON d."runId"=${op.runId} AND d."artworkId"=i."artworkId" AND d."imageId"=i.id
    )
    SELECT c."revisionId",c."providerKey",c."externalId",c."sealedManifestSha256",${item.memberCount}::bigint "memberCount" FROM candidate c
    WHERE (SELECT count(*) FROM "Image" i WHERE i."artworkId"=${item.artworkId})=${item.memberCount}
      AND (SELECT count(*)=${item.memberCount} AND count(DISTINCT "itemId")=${item.memberCount} AND count(DISTINCT "imageId")=${item.memberCount} AND bool_and(coalesce(valid,false)) FROM mapping)
    LIMIT 2`)
  if (rows.length !== 1) throw new ArtworkDedupOperationError('ARCHIVE_MANIFEST_UNVERIFIED')
  return rows[0]!
}
