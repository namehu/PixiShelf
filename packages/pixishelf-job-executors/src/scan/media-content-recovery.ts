import { createHash } from 'node:crypto'
import type { Prisma } from '@pixishelf/db'
import {
  archiveMaintenancePayloadSchema,
  archiveImportV2PayloadSchema,
  pendingReplacePayloadSchema,
  videoStreamingOptimizationPayloadSchema
} from '@pixishelf/job-contracts'
import { ScanExecutorError } from './errors.ts'

/** Shared by offline inspect/confirm and the fenced Worker consumer; never trusts a caller-supplied digest. */
export async function readExecutorMediaRecoveryDomainSnapshot(
  tx: Prisma.TransactionClient,
  input: { jobId: string; sessionId: string }
): Promise<Prisma.JsonValue> {
  const job = await tx.systemJob.findUniqueOrThrow({
    where: { id: input.jobId },
    select: { id: true, type: true, payload: true }
  })
  const binding = { jobId: job.id, jobType: job.type, payload: job.payload, sessionId: input.sessionId }
  if (job.type === 'PENDING_REPLACE') {
    const payload = pendingReplacePayloadSchema.parse(job.payload)
    if (payload.mode !== 'BATCH' && payload.mode !== 'RESTORE') throw unavailable()
    const prefix = payload.mode === 'BATCH' ? 'pending-replace:' : 'pending-restore:'
    if (!input.sessionId.startsWith(prefix)) throw unavailable()
    const itemId = input.sessionId.slice(prefix.length)
    const [operation, item] = await Promise.all([
      tx.pendingReplaceOperation.findUnique({ where: { systemJobId: job.id } }),
      tx.pendingReplaceItem.findUnique({ where: { id: itemId } })
    ])
    if (
      !operation ||
      !item ||
      operation.batchId !== payload.batchId ||
      operation.mode !== payload.mode ||
      item.batchId !== payload.batchId ||
      !item.artworkId ||
      !item.targetDirectory ||
      (payload.mode === 'BATCH'
        ? !payload.itemIds.includes(itemId)
        : payload.itemId !== itemId || operation.itemId !== itemId)
    )
      throw unavailable()
    const artwork = await artworkIdentity(tx, item.artworkId)
    return json({
      ...binding,
      operation,
      artwork,
      item: {
        id: item.id,
        batchId: item.batchId,
        artworkId: item.artworkId,
        status: item.status,
        included: item.included,
        sourceDirectory: item.sourceDirectory,
        targetDirectory: item.targetDirectory,
        backupDirectory: item.backupDirectory,
        completedDirectory: item.completedDirectory,
        fingerprint: item.fingerprint,
        sourceManifest: digest(item.sourceManifest, 2 * 1024 * 1024),
        oldMediaSnapshot: digest(item.oldMediaSnapshot, 2 * 1024 * 1024),
        newMediaSnapshot: digest(item.newMediaSnapshot, 2 * 1024 * 1024),
        targetFileSnapshot: digest(item.targetFileSnapshot, 2 * 1024 * 1024)
      }
    })
  }
  if (job.type === 'MIGRATION') {
    if (!input.sessionId.startsWith('migration:')) throw unavailable()
    const item = await tx.migrationJobItem.findUnique({
      where: { id: input.sessionId.slice('migration:'.length) },
      include: { files: { orderBy: { ordinal: 'asc' }, take: 5001 } }
    })
    if (
      !item ||
      item.systemJobId !== job.id ||
      item.files.length > 5000 ||
      ['COMPLETED', 'SKIPPED', 'FAILED', 'CANCELLED'].includes(item.status)
    )
      throw unavailable()
    return json({
      ...binding,
      artwork: await artworkIdentity(tx, item.artworkIdSnapshot),
      item: {
        id: item.id,
        artworkId: item.artworkIdSnapshot,
        status: item.status,
        phase: item.phase,
        sourceDirectory: item.sourceDirectory,
        targetDirectory: item.targetDirectory,
        sourceFingerprint: item.sourceFingerprint,
        targetFingerprint: item.targetFingerprint,
        fileCount: item.files.length,
        files: digest(
          item.files.map((file) => ({
            id: file.id,
            ordinal: file.ordinal,
            imageId: file.imageId,
            sourceRelativePath: file.sourceRelativePath,
            targetRelativePath: file.targetRelativePath,
            stagedRelativePath: file.stagedRelativePath,
            status: file.status,
            sourceSize: file.sourceSize,
            sourceMtimeMs: file.sourceMtimeMs,
            sourceSha256: file.sourceSha256,
            stagedSha256: file.stagedSha256,
            transferredAt: file.transferredAt,
            publishedAt: file.publishedAt,
            cleanedAt: file.cleanedAt
          })),
          32 * 1024 * 1024
        )
      }
    })
  }
  if (job.type === 'VIDEO_STREAMING_OPTIMIZATION') {
    if (input.sessionId !== `video-remux:${job.id}`) throw unavailable()
    const payload = videoStreamingOptimizationPayloadSchema.parse(job.payload)
    const image = await tx.image.findUnique({
      where: { id: payload.imageId },
      select: { id: true, artworkId: true, path: true, mediaType: true, size: true }
    })
    if (!image || image.path !== payload.relativePath) throw unavailable()
    return json({ ...binding, image })
  }
  if (job.type === 'ARCHIVE_PUBLISH') {
    const payload = archiveImportV2PayloadSchema.parse(job.payload)
    if (input.sessionId !== `archive-publish:${payload.archiveImportId}`) throw unavailable()
    const [archive, execution] = await Promise.all([
      tx.archiveImport.findUnique({ where: { id: payload.archiveImportId }, include: { publishedRevision: true } }),
      tx.archiveImportExecution.findUnique({ where: { jobId: job.id } })
    ])
    if (
      !archive ||
      archive.systemJobId !== job.id ||
      archive.phase !== 'PUBLISH' ||
      archive.cleanupRequestedAt ||
      archive.publishedRevision ||
      !archive.generationToken ||
      !archive.sealedManifestSha256 ||
      execution?.archiveImportId !== archive.id ||
      execution.phase !== 'PUBLISH'
    )
      throw unavailable()
    const generation = await tx.archiveStagingGeneration.findUnique({ where: { token: archive.generationToken } })
    if (
      !generation ||
      generation.archiveImportId !== archive.id ||
      generation.path !== archive.stagingPath ||
      !generation.sealedAt ||
      !generation.drainedAt ||
      generation.cleanedAt ||
      generation.manifestSha256 !== archive.sealedManifestSha256
    )
      throw unavailable()
    const source = await tx.artworkExternalRef.findUnique({
      where: { providerKey_externalId: { providerKey: archive.providerKey, externalId: archive.externalId } },
      select: { artworkId: true }
    })
    const artwork = source ? await artworkIdentity(tx, source.artworkId) : null
    if (artwork && (artwork.deletedAt || artwork.archiveLifecycleState !== 'ACTIVE')) throw unavailable()
    return json({
      ...binding,
      artwork,
      execution,
      archive: {
        id: archive.id,
        systemJobId: archive.systemJobId,
        phase: archive.phase,
        providerKey: archive.providerKey,
        creatorBucket: archive.creatorBucket,
        externalId: archive.externalId,
        generationToken: archive.generationToken,
        stagingPath: archive.stagingPath,
        sealedManifestSha256: archive.sealedManifestSha256
      },
      generation
    })
  }
  if (job.type === 'ARCHIVE_MAINTENANCE') {
    const payload = archiveMaintenancePayloadSchema.parse(job.payload)
    if (
      payload.action === 'CLEAN_STAGING' ||
      payload.action === 'RECONCILE' ||
      input.sessionId !== `archive-maintenance:${job.id}`
    )
      throw unavailable()
    const artwork = await artworkIdentity(tx, payload.artworkId)
    const expected =
      payload.action === 'TRASH_ARCHIVE' ? 'TRASHING' : payload.action === 'RESTORE_ARCHIVE' ? 'RESTORING' : 'TRASHED'
    if (artwork.createdVia !== 'URL_ARCHIVE' || artwork.archiveLifecycleState !== expected || !artwork.deletedAt)
      throw unavailable()
    const revisions = await archiveMaintenanceRevisionsSnapshot(tx, artwork.id)
    return json({ ...binding, artwork, revisions })
  }
  throw unavailable()
}

async function archiveMaintenanceRevisionsSnapshot(tx: Prisma.TransactionClient, artworkId: number) {
  const version = 1
  const hash = createHash('sha256').update('archive-maintenance-revisions:v1\n')
  let count = 0n
  let afterId: string | undefined
  while (true) {
    const page = await tx.archiveRevision.findMany({
      where: { artworkId, ...(afterId === undefined ? {} : { id: { gt: afterId } }) },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true, archivePath: true, trashPath: true, trashedAt: true, purgeAfter: true }
    })
    for (const revision of page) {
      if (!revision.trashPath) throw unavailable()
      const encoded = encode(revision)
      // Length framing makes every complete row part of the digest without retaining previous pages.
      hash.update(`${Buffer.byteLength(encoded, 'utf8')}:`).update(encoded)
      count += 1n
    }
    if (page.length < 100) break
    afterId = page[page.length - 1]!.id
  }
  if (count === 0n) throw unavailable()
  return { version, count: count.toString(), sha256: hash.digest('hex') }
}

async function artworkIdentity(tx: Prisma.TransactionClient, id: number) {
  return tx.artwork.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      createdVia: true,
      deletedAt: true,
      archiveLifecycleState: true,
      storagePath: true,
      storageKey: true,
      metaSource: true
    }
  })
}

function json(value: unknown): Prisma.JsonValue {
  return JSON.parse(encode(value)) as Prisma.JsonValue
}
function digest(value: unknown, limit: number): string {
  const bytes = encode(value)
  if (Buffer.byteLength(bytes, 'utf8') > limit) throw unavailable()
  return createHash('sha256').update(bytes).digest('hex')
}
function encode(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return { bigint: item.toString() }
    if (item && typeof item === 'object' && !Array.isArray(item))
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    return item
  })
}
function unavailable() {
  return new ScanExecutorError(
    'STATE_CONFLICT',
    'Media content recovery domain checkpoint is missing, unsupported or changed'
  )
}
