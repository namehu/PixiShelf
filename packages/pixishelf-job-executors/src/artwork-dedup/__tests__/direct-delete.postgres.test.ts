import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
// Preserve the Worker fail-closed branch independently of an isolated release candidate.
vi.mock('@pixishelf/job-contracts', async (original) => {
  const actual = await original<typeof import('@pixishelf/job-contracts')>()
  const enabled: typeof actual.isArtworkDedupMaintenanceModeEnabled = (mode, purpose) => mode === 'DIRECT_DELETE' || purpose === 'DIRECT_DELETE' ? false : actual.isArtworkDedupMaintenanceModeEnabled(mode, purpose)
  return { ...actual, ARTWORK_DEDUP_DIRECT_DELETE_ENABLED: false, isArtworkDedupMaintenanceModeEnabled: enabled, assertArtworkDedupMaintenanceModeEnabled: (mode: Parameters<typeof enabled>[0], purpose: Parameters<typeof enabled>[1]) => { if (!enabled(mode, purpose)) throw new Error('ARTWORK_DEDUP_MODE_DISABLED') } }
})
import {
  authorizeArtworkDedupDirectDelete,
  completeArtworkDedupPrepare,
  retryArtworkDedupDirectDelete,
  allowArtworkDedupDirectDeleteReimport,
  requestArtworkDedupDirectDeleteStop,
  freezeArtworkDedupRun,
  type Prisma
} from '@pixishelf/db'
import { isArtworkDedupMaintenanceModeEnabled, type ArtworkDedupMaintenancePayload, type ArtworkDedupScanPayload } from '@pixishelf/job-contracts'
import type { QueueSqlExecutor, FencedExecutionTransaction } from '@pixishelf/job-runtime'
import { executeArtworkDedupDirectDelete } from '../direct-delete.ts'
import { executeArtworkDedupMaintenance } from '../maintenance-executor.ts'
import { executeArtworkDedup } from '../executor.ts'
import {
  db,
  fixture,
  finishInventory,
  finishDirectory,
  repository,
  fence,
  executionContext,
  clock,
  readerOptions,
  root,
  trackMaintenanceJob,
  trackDedupRun
} from './maintenance-executor-fixture.ts'

type Kind = 'MANUAL_CREATE' | 'LOCAL_DIRECTORY' | 'PIXIV_SCAN' | 'URL_ARCHIVE'
async function prepared(kinds: Kind[] = ['LOCAL_DIRECTORY', 'LOCAL_DIRECTORY'], count = 1, groups = 1, beforeScan?: (ids: number[]) => Promise<void>, visualKeeperIndex?: number, partialKeeperIndex?: number) {
  const f = await fixture(count, kinds[0], {
    purpose: 'DIRECT_DELETE',
    ...(partialKeeperIndex !== undefined ? { partialKeeperIndex } : {}),
    ...(visualKeeperIndex !== undefined ? { visualKeeperIndex } : {}),
    kinds,
    groups,
    archiveBytes: kinds.includes('URL_ARCHIVE'),
    ...(beforeScan ? { beforeScan } : {})
  })
  try {
    for (const id of f.ids) {
      await finishInventory(f, id)
      await finishDirectory(f, id)
    }
    await f.detachReader()
    await repository!.withFencedExecutionTransaction<Prisma.TransactionClient & QueueSqlExecutor>(
      fence(f.job),
      async (scope) => {
        const op = await completeArtworkDedupPrepare(scope.transaction, { execution: f.context.execution })
        expect(op.status).toBe('READY')
        expect(op.scopeDigest).toMatch(/^[a-f0-9]{64}$/)
        await scope.complete({ result: { operationId: op.id } })
      }
    )
    return await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: f.context.execution.operationId } })
  } finally {
    await f.close()
  }
}
type Op = Awaited<ReturnType<typeof prepared>>
const command = (op: Op) => ({
  userId: op.requestedBy,
  expectedUserId: op.requestedBy,
  operationId: op.id,
  expectedVersion: op.version,
  idempotencyKey: randomUUID()
})
const confirmation = (op: Op) => ({
  ...command(op),
  purpose: 'DIRECT_DELETE' as const,
  protocolVersion: op.protocolVersion as 1 | 2 | 3 | 4,
  ...([3, 4].includes(op.protocolVersion ?? 0) ? { differentContentLossConfirmed: true as const } : {}),
  scopeDigest: op.scopeDigest!,
  externalWritesStopped: true as const,
  permanentDeleteConfirmed: true as const,
  organizationImpactConfirmed: true as const
})
async function start(op: Op, retry = false) {
  await db!.$transaction(
    async (tx) => {
      const result = retry
        ? await retryArtworkDedupDirectDelete(tx, command(op))
        : await authorizeArtworkDedupDirectDelete(tx, confirmation(op))
      const job = await tx.systemJob.create({
        data: {
          type: 'ARTWORK_DEDUP_MAINTENANCE',
          definitionVersion: op.protocolVersion === 4 ? 5 : op.protocolVersion === 3 ? 4 : 1,
          executionLane: 'BACKGROUND_WRITER',
          triggerSource: 'SYSTEM',
          queuePriority: 900,
          effectivePriority: 900,
          availableAt: clock.now(),
          payload: { operationId: op.id, executionVersion: result.operation.executionVersion, mode: 'DIRECT_DELETE' }
        }
      })
      trackMaintenanceJob(job.id)
      await tx.artworkDedupOperation.update({ where: { id: op.id }, data: { jobId: job.id } })
    },
    { timeout: 20000 }
  )
  const job = await repository!.claim('direct-delete-fixture', [
    { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 4, 5] }
  ])
  expect(job).not.toBeNull()
  return job!
}
async function bind(op: Op) {
  const job = await db!.systemJob.create({
    data: {
      type: 'ARTWORK_DEDUP_MAINTENANCE',
      executionLane: 'BACKGROUND_WRITER',
      triggerSource: 'SYSTEM',
      queuePriority: 900,
      effectivePriority: 900,
      availableAt: clock.now(),
      payload: { operationId: op.id, executionVersion: op.executionVersion, mode: 'DIRECT_DELETE' }
    }
  })
  trackMaintenanceJob(job.id)
  await db!.artworkDedupOperation.update({ where: { id: op.id }, data: { jobId: job.id } })
  const claimed = await repository!.claim('bound-command', [
    { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 4, 5] }
  ])
  expect(claimed?.id).toBe(job.id)
  return claimed!
}
const deps = () => ({
  database: db!,
  sourceRoot: root,
  archiveRoot: root,
  readerOptions,
  now: () => clock.now().getTime()
})
async function animationOriginals(ids: number[]) {
  for (const id of ids) {
    const images = await db!.image.findMany({ where: { artworkId: id }, orderBy: { sortOrder: 'asc' } })
    for (const [n, image] of images.entries()) {
      const extension = ['apng', 'mp4', 'webp'][n]!
      const relative = `${path.posix.dirname(image.path)}/animation.${extension}`
      await fs.rename(path.join(root, image.path), path.join(root, relative))
      await db!.image.update({ where: { id: image.id }, data: { path: relative, mediaType: n === 1 ? 'VIDEO' : 'ANIMATION', ...(n === 0 ? { animationMetadata: { create: { format: 'APNG', frameCount: 2, durationMs: 100n } } } : {}) } })
    }
  }
}
const current = (op: Pick<Op, 'id'>) => db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: op.id } })
describe.skipIf(!db).sequential('DIRECT_DELETE frozen exact files', () => {
  it.each((['EXACT', 'CONTAINS'] as const).flatMap(kind =>
    (['MANUAL_CREATE', 'LOCAL_DIRECTORY', 'PIXIV_SCAN', 'URL_ARCHIVE'] as const).map(source => ({ kind, source }))
  ))('deletes legacy zero-version $kind / $source copies through scan, preview, authorization and execution', async ({ kind, source }) => {
    const op = await prepared([source, kind === 'EXACT' ? source : 'LOCAL_DIRECTORY'], 1, 1, async ids => {
      if (kind === 'CONTAINS') {
        const image = await db!.image.findFirstOrThrow({ where: { artworkId: ids[1]! } })
        const relative = `${path.posix.dirname(image.path)}/extra.bin`
        await fs.writeFile(path.join(root, relative), 'legacy-extra-original')
        await db!.image.create({ data: { artworkId: ids[1]!, path: relative, sortOrder: 9 } })
      }
      await db!.artworkContentSource.deleteMany({ where: { artworkId: { in: ids } } })
    })
    const items = await db!.artworkDedupOperationArtwork.findMany({ where: { operationId: op.id } })
    expect(items).toHaveLength(2)
    expect(items.every(item => item.snapshotRevision === 0n && item.mediaEpoch === 0n)).toBe(true)
    expect(await db!.artworkContentSource.count({ where: { artworkId: { in: items.map(item => item.artworkId) } } })).toBe(0)
    const keeper = items.find(item => item.role === 'KEEPER')!, copy = items.find(item => item.role === 'COPY')!
    const keptFiles = await db!.artworkDedupOperationFile.findMany({ where: { operationId: op.id, artworkId: keeper.artworkId, role: 'MEDIA' } })
    const bytes = await Promise.all(keptFiles.map(file => fs.readFile(path.join(root, file.canonicalPath))))
    const job = await start(op)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
    expect(await current(op)).toMatchObject({ status: 'DELETED', errorCode: null })
    expect(await db!.artwork.findUnique({ where: { id: copy.artworkId } })).toBeNull()
    expect(await db!.artwork.findUnique({ where: { id: keeper.artworkId } })).not.toBeNull()
    for (const [index, file] of keptFiles.entries()) expect(await fs.readFile(path.join(root, file.canonicalPath))).toEqual(bytes[index])
  }, 30_000)
  it.each([0, 1])('F01 deletes only the discarded partial side with keeper index %i', async keeperIndex => {
    const op = await prepared(['MANUAL_CREATE', 'MANUAL_CREATE'], 5, 1, async ids => {
      const image = await db!.image.findFirstOrThrow({ where: { artworkId: ids[1]! }, orderBy: { sortOrder: 'desc' } })
      await fs.writeFile(path.join(root, image.path), Buffer.alloc(8, 99))
    }, undefined, keeperIndex)
    expect(op.protocolVersion).toBe(4)
    const { differentContentLossConfirmed: _loss, ...missingLoss } = confirmation(op)
    await expect(db!.$transaction(tx => authorizeArtworkDedupDirectDelete(tx, missingLoss))).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    for (const protocolVersion of [1, 2, 3] as const)
      await expect(db!.$transaction(tx => authorizeArtworkDedupDirectDelete(tx, { ...confirmation(op), protocolVersion }))).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    const files = await db!.artworkDedupOperationFile.findMany({ where: { operationId: op.id, role: 'MEDIA' }, include: { artwork: true } })
    const kept = new Map(await Promise.all(files.filter(f => f.artwork.role === 'KEEPER').map(async f => [f.fileId, await fs.readFile(path.join(root, f.canonicalPath))] as const)))
    const job = await start(op)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
    expect(await current(op)).toMatchObject({ status: 'DELETED', deletedFiles: 5n, errorCode: null })
    for (const file of files) {
      if (file.artwork.role === 'KEEPER') expect(await fs.readFile(path.join(root, file.canonicalPath))).toEqual(kept.get(file.fileId))
      else await expect(fs.stat(path.join(root, file.canonicalPath))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  }, 30_000)
  it.each(['KEEPER', 'COPY'] as const)('F01 refuses changed %s bytes before any unlink', async role => {
    const op = await prepared(['MANUAL_CREATE', 'MANUAL_CREATE'], 5, 1, async ids => {
      const image = await db!.image.findFirstOrThrow({ where: { artworkId: ids[1]! }, orderBy: { sortOrder: 'desc' } })
      await fs.writeFile(path.join(root, image.path), Buffer.alloc(8, 99))
    }, undefined, 0)
    const file = await db!.artworkDedupOperationFile.findFirstOrThrow({ where: { operationId: op.id, role: 'MEDIA', artwork: { role } } })
    const job = await start(op)
    await fs.writeFile(path.join(root, file.canonicalPath), Buffer.alloc(8, 77))
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
    expect(await current(op)).toMatchObject({ status: 'RECOVERY_REQUIRED', errorCode: 'FILE_CHANGED' })
    expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id, step: 'DELETE' } })).toBe(0)
    expect(await db!.artworkDedupOperationFile.count({ where: { operationId: op.id, status: 'DELETED' } })).toBe(0)
  }, 30_000)
  it.each<Kind>(['MANUAL_CREATE', 'LOCAL_DIRECTORY', 'PIXIV_SCAN', 'URL_ARCHIVE'])(
    'deletes contained %s originals only, retaining the larger mixed-source work', async (smallKind) => {
      const op = await prepared([smallKind, 'LOCAL_DIRECTORY'], 1, 1, async (ids) => {
        const image = await db!.image.findFirstOrThrow({ where: { artworkId: ids[1]! } })
        const relative = `${path.posix.dirname(image.path)}/extra.bin`
        await fs.writeFile(path.join(root, relative), 'unique-extra-original')
        await db!.image.create({ data: { artworkId: ids[1]!, path: relative, sortOrder: 9 } })
      })
      expect(op.protocolVersion).toBe(2)
      const items = await db!.artworkDedupOperationArtwork.findMany({ where: { operationId: op.id } })
      const small = items.find((i) => i.role === 'COPY')!, large = items.find((i) => i.role === 'KEEPER')!
      expect([small.memberCount, large.memberCount]).toEqual([1n, 2n])
      const keepFiles = await db!.artworkDedupOperationFile.findMany({ where: { operationId: op.id, artworkId: large.artworkId } })
      const job = await start(op)
      await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
      expect(await current(op)).toMatchObject({ status: 'DELETED', errorCode: null })
      expect(await db!.artwork.findUnique({ where: { id: small.artworkId } })).toBeNull()
      expect(await db!.image.count({ where: { artworkId: large.artworkId } })).toBe(2)
      for (const file of keepFiles) expect((await fs.stat(path.join(root, file.canonicalPath))).isFile()).toBe(true)
    }, 30_000)
  it.each([0, 1])('visual single pair deletes the explicitly discarded side with keeper index %i', async (keeperIndex) => {
    const op = await prepared(['MANUAL_CREATE', 'MANUAL_CREATE'], 1, 1, async ids => {
      const images = await db!.image.findMany({ where: { artworkId: { in: ids } }, orderBy: { artworkId: 'asc' } })
      const pixels = Buffer.from(Array.from({ length: 192 * 192 * 3 }, (_, i) => (Math.floor((Math.floor(i / 3) % 192) / 16) * 41 + Math.floor(Math.floor(i / 576) / 20) * 71) % 255))
      const image = await sharp(pixels, { raw: { width: 192, height: 192, channels: 3 } }).png().toBuffer()
      await fs.writeFile(path.join(root, images[0]!.path), image)
      await fs.writeFile(path.join(root, images[1]!.path), await sharp(image).extend({ top: 20, bottom: 20, left: 20, right: 20, background: 'white' }).png().toBuffer())
    }, keeperIndex)
    expect(op.protocolVersion).toBe(3)
    const group = await db!.artworkDedupOperationGroup.findFirstOrThrow({ where: { operationId: op.id } })
    expect(group).toMatchObject({ relationKind: 'VISUAL', selectionBasis: 'SAVED' })
    const { differentContentLossConfirmed: _loss, ...missingLoss } = confirmation(op)
    await expect(db!.$transaction(tx => authorizeArtworkDedupDirectDelete(tx, missingLoss))).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    await expect(db!.$transaction(tx => authorizeArtworkDedupDirectDelete(tx, { ...confirmation(op), protocolVersion: 2 }))).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })
    const files = await db!.artworkDedupOperationFile.findMany({ where: { operationId: op.id, role: 'MEDIA' }, include: { artwork: true } })
    expect(new Set(files.map(f => f.sha256)).size).toBe(2)
    const job = await start(op)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
    expect(await current(op)).toMatchObject({ status: 'DELETED', deletedFiles: 1n, errorCode: null })
    for (const file of files) {
      if (file.artwork.role === 'KEEPER') expect((await fs.stat(path.join(root, file.canonicalPath))).isFile()).toBe(true)
      else await expect(fs.stat(path.join(root, file.canonicalPath))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  }, 30_000)
  it('includes every physical animation/video original in containment deletion', async () => {
    const op = await prepared(['MANUAL_CREATE', 'MANUAL_CREATE'], 3, 1, async (ids) => {
      await animationOriginals(ids)
      const image = await db!.image.findFirstOrThrow({ where: { artworkId: ids[1]! } })
      const relative = `${path.posix.dirname(image.path)}/extra.bin`
      await fs.writeFile(path.join(root, relative), 'extra')
      await db!.image.create({ data: { artworkId: ids[1]!, path: relative } })
    })
    const job = await start(op)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
    expect(await current(op)).toMatchObject({ status: 'DELETED', deletedFiles: 3n })
  }, 30_000)
  it.each(['modified', 'missing'] as const)('rejects %s contained original before first deletion', async (change) => {
    const op = await prepared(['LOCAL_DIRECTORY', 'LOCAL_DIRECTORY'], 1, 1, async (ids) => {
      const image = await db!.image.findFirstOrThrow({ where: { artworkId: ids[1]! } })
      const relative = `${path.posix.dirname(image.path)}/extra.bin`
      await fs.writeFile(path.join(root, relative), 'extra')
      await db!.image.create({ data: { artworkId: ids[1]!, path: relative } })
    })
    const copy = await db!.artworkDedupOperationFile.findFirstOrThrow({ where: { operationId: op.id, role: 'MEDIA', artwork: { role: 'COPY' } } })
    if (change === 'missing') await fs.unlink(path.join(root, copy.canonicalPath))
    else await fs.writeFile(path.join(root, copy.canonicalPath), 'changed!')
    const job = await start(op)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
    expect(await current(op)).toMatchObject({ status: 'RECOVERY_REQUIRED', deletedFiles: 0n })
    expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id } })).toBe(0)
    expect(await db!.artwork.findUnique({ where: { id: copy.artworkId } })).toMatchObject({ deletedAt: null })
  }, 30_000)
  it('keeps independent API and task capability closed', async () => {
    expect(isArtworkDedupMaintenanceModeEnabled('DIRECT_DELETE', 'DIRECT_DELETE')).toBe(false)
    expect(isArtworkDedupMaintenanceModeEnabled('PREPARE', 'DIRECT_DELETE')).toBe(false)
    const op = await prepared(['MANUAL_CREATE', 'MANUAL_CREATE'])
    const job = await start(op)
    await expect(
      executeArtworkDedupMaintenance(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
    ).rejects.toThrow('ARTWORK_DEDUP_MODE_DISABLED')
    await repository!.fail({ ...fence(job), errorCode: 'INTERNAL_ERROR', error: 'gate test complete' })
    expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id } })).toBe(0)
  })
  it.each<Kind[]>([
    ['MANUAL_CREATE', 'MANUAL_CREATE'],
    ['LOCAL_DIRECTORY', 'LOCAL_DIRECTORY'],
    ['PIXIV_SCAN', 'PIXIV_SCAN'],
    ['URL_ARCHIVE', 'URL_ARCHIVE'],
    ['MANUAL_CREATE', 'URL_ARCHIVE'],
    ['MANUAL_CREATE', 'LOCAL_DIRECTORY'],
    ['MANUAL_CREATE', 'PIXIV_SCAN'],
    ['LOCAL_DIRECTORY', 'PIXIV_SCAN'],
    ['LOCAL_DIRECTORY', 'URL_ARCHIVE'],
    ['PIXIV_SCAN', 'URL_ARCHIVE']
  ])('deletes exact %s / %s originals and preserves directories, keeper and tombstones', async (a, b) => {
    const op = await prepared([a, b])
    const job = await start(op)
    const items = await db!.artworkDedupOperationArtwork.findMany({ where: { operationId: op.id } })
    const copy = items.find((i) => i.role === 'COPY')!,
      keeper = items.find((i) => i.role === 'KEEPER')!
    const files = await db!.artworkDedupOperationFile.findMany({
      where: { operationId: op.id, artworkId: copy.artworkId }
    })
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
    expect((await current(op)).status).toBe('DELETED')
    expect(await db!.artwork.findUnique({ where: { id: copy.artworkId } })).toBeNull()
    expect((await db!.artwork.findUniqueOrThrow({ where: { id: keeper.artworkId } })).deletedAt).toBeNull()
    for (const file of files) {
      await expect(fs.stat(path.join(root, file.canonicalPath))).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await fs.stat(path.dirname(path.join(root, file.canonicalPath)))).isDirectory()).toBe(true)
    }
    expect(await db!.artworkDedupClaim.count({ where: { operationId: op.id } })).toBe(0)
    expect(
      await db!.artworkDedupSourceIdentity.count({ where: { ownerOperationId: op.id, status: 'TOMBSTONE' } })
    ).toBeGreaterThan(0)
    if (a === 'MANUAL_CREATE' && b === 'MANUAL_CREATE') {
      expect(
        await db!.artworkDedupOperationSource.count({ where: { operationId: op.id, source: { kind: 'PROVIDER' } } })
      ).toBe(0)
    }
  })
  it('deletes every registered animation physical original rather than one logical representative', async () => {
    const op = await prepared(['MANUAL_CREATE', 'MANUAL_CREATE'], 3, 1, animationOriginals)
    expect(op.preparedFiles).toBe(6n)
    const copy = await db!.artworkDedupOperationArtwork.findFirstOrThrow({ where: { operationId: op.id, role: 'COPY' } })
    const files = await db!.artworkDedupOperationFile.findMany({ where: { operationId: op.id, artworkId: copy.artworkId } })
    expect(files.map((file) => path.extname(file.canonicalPath)).sort()).toEqual(['.apng', '.mp4', '.webp'])
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(await start(op)), deps())
    expect((await current(op)).deletedFiles).toBe(3n)
    expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id, status: 'COMPLETED', step: 'DELETE' } })).toBe(3)
    for (const file of files) await expect(fs.stat(path.join(root, file.canonicalPath))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('a registered duplicate occurrence difference creates containment, never an exact animation group', async () => {
    const f = await fixture(3, 'MANUAL_CREATE', { purpose: 'DIRECT_DELETE', beforeScan: animationOriginals })
    await f.close()
    const original = await current({ id: f.context.execution.operationId })
    const image = await db!.image.findFirstOrThrow({ where: { artworkId: f.ids[1]! }, orderBy: { sortOrder: 'asc' } })
    const relative = `${path.posix.dirname(image.path)}/duplicate.apng`
    await fs.copyFile(path.join(root, image.path), path.join(root, relative))
    await db!.image.create({ data: { artworkId: image.artworkId, path: relative, size: image.size, mediaType: 'ANIMATION', sortOrder: 3 } })
    const job = await db!.$transaction(async (tx) => {
      const { run } = await freezeArtworkDedupRun(tx, { artistId: original.artistId, requestedBy: original.requestedBy, idempotencyKey: randomUUID(), mode: 'FULL' })
      trackDedupRun(run.id)
      const created = await tx.systemJob.create({ data: { type: 'ARTWORK_DEDUP_SCAN', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, availableAt: clock.now(), payload: { runId: run.id, executionVersion: run.executionVersion } } })
      trackMaintenanceJob(created.id)
      await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: created.id } })
      return created
    })
    const claimed = await repository!.claim('animation-count', [{ jobType: 'ARTWORK_DEDUP_SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 4, 5] }])
    expect(claimed?.id).toBe(job.id)
    await executeArtworkDedup(executionContext<ArtworkDedupScanPayload>(claimed!), deps())
    const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { jobId: job.id } })
    expect(run).toMatchObject({ status: 'COMPLETED', groupCount: 1 })
    expect(await db!.artworkDedupGroup.count({ where: { runId: run.id } })).toBe(0)
    expect(await db!.artworkDedupRelation.findFirst({ where: { runId: run.id } })).toMatchObject({ containedArtworkId: f.ids[0], containerArtworkId: f.ids[1], containedFileCount: 3n, containerFileCount: 4n })
  })
  it.each(['INTENT', 'UNLINKED', 'RECEIPTED'] as const)(
    'retains intent/hidden/claims after %s failure and resumes only original scope',
    async (boundary) => {
      const op = await prepared(['LOCAL_DIRECTORY', 'LOCAL_DIRECTORY'], 2),
        job = await start(op)
      let injected = false
      await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), {
        ...deps(),
        onDirectDeleteBoundary: async (point) => {
          if (!injected && point === boundary) {
            injected = true
            throw new Error('synthetic boundary failure')
          }
        }
      })
      let failed = await current(op)
      expect(failed.status).toBe('RECOVERY_REQUIRED')
      expect(await db!.artworkDedupClaim.count({ where: { operationId: op.id } })).toBe(2)
      const copy = await db!.artworkDedupOperationArtwork.findFirstOrThrow({
        where: { operationId: op.id, role: 'COPY' }
      })
      expect((await db!.artwork.findUniqueOrThrow({ where: { id: copy.artworkId } })).deletedAt).not.toBeNull()
      const retryJob = await start(failed, true)
      await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(retryJob), deps())
      expect((await current(op)).status).toBe('DELETED')
    }
  )
  it('stops before first intent with zero deletion, releases only after reader exit, and binds idempotency', async () => {
    const op = await prepared()
    const input = confirmation(op)
    await db!.$transaction(async (tx) => {
      const one = await authorizeArtworkDedupDirectDelete(tx, input)
      const two = await authorizeArtworkDedupDirectDelete(tx, input)
      expect(two.created).toBe(false)
      expect(two.operation.id).toBe(one.operation.id)
    })
    await expect(
      db!.$transaction((tx) => authorizeArtworkDedupDirectDelete(tx, { ...input, scopeDigest: 'f'.repeat(64) }))
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    // This fixture binds the already authorized operation without issuing a second authorization.
    const active = await current(op)
    const job = await db!.systemJob.create({
      data: {
        type: 'ARTWORK_DEDUP_MAINTENANCE',
        executionLane: 'BACKGROUND_WRITER',
        triggerSource: 'SYSTEM',
        queuePriority: 900,
        effectivePriority: 900,
        availableAt: clock.now(),
        payload: { operationId: op.id, executionVersion: active.executionVersion, mode: 'DIRECT_DELETE' }
      }
    })
    trackMaintenanceJob(job.id)
    await db!.artworkDedupOperation.update({ where: { id: op.id }, data: { jobId: job.id } })
    const claimed = await repository!.claim('stop-fixture', [
      { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 4, 5] }
    ])
    await db!.$transaction((tx) => requestArtworkDedupDirectDeleteStop(tx, command(active)))
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(claimed!), deps())
    expect((await current(op)).status).toBe('CANCELLED')
    expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id } })).toBe(0)
  })
  it('last selected group changing causes zero first intents across every group', async () => {
    const op = await prepared(['LOCAL_DIRECTORY', 'LOCAL_DIRECTORY'], 1, 2)
    const last = await db!.artworkDedupOperationFile.findFirstOrThrow({
      where: { operationId: op.id, role: 'MEDIA' },
      orderBy: { artworkId: 'desc' }
    })
    await fs.writeFile(path.join(root, last.canonicalPath), 'changed!')
    const job = await start(op)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
    expect((await current(op)).status).toBe('RECOVERY_REQUIRED')
    expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id } })).toBe(0)
    expect(
      await db!.artwork.count({
        where: {
          id: {
            in: (await db!.artworkDedupOperationArtwork.findMany({ where: { operationId: op.id } })).map(
              (a) => a.artworkId
            )
          },
          deletedAt: { not: null }
        }
      })
    ).toBe(0)
  })
  it('keeper change after partial failure blocks retry without deleting the remaining copy', async () => {
    const op = await prepared(['LOCAL_DIRECTORY', 'LOCAL_DIRECTORY'], 2),
      job = await start(op)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), {
      ...deps(),
      onDirectDeleteBoundary: async (point) => {
        if (point === 'RECEIPTED') throw new Error('stop after one')
      }
    })
    const keeper = await db!.artworkDedupOperationFile.findFirstOrThrow({
      where: { operationId: op.id, role: 'MEDIA', artwork: { role: 'KEEPER' } }
    })
    await fs.writeFile(path.join(root, keeper.canonicalPath), 'changed!')
    const retry = await start(await current(op), true)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(retry), deps())
    expect((await current(op)).status).toBe('RECOVERY_REQUIRED')
    expect(await db!.artworkDedupOperationFile.count({ where: { operationId: op.id, status: 'DELETED' } })).toBe(1)
    expect(await db!.artworkDedupClaim.count({ where: { operationId: op.id } })).toBe(2)
  })
  it('stop after a durable intent retains hidden copies and hold at a file boundary', async () => {
    const op = await prepared(['LOCAL_DIRECTORY', 'LOCAL_DIRECTORY'], 2),
      job = await start(op)
    let requested = false
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), {
      ...deps(),
      onDirectDeleteBoundary: async (point) => {
        if (point === 'RECEIPTED' && !requested) {
          requested = true
          await db!.$transaction(async (tx) => requestArtworkDedupDirectDeleteStop(tx, command(await current(op))))
        }
      }
    })
    expect((await current(op)).status).toBe('STOPPED')
    expect(await db!.artworkDedupOperationFile.count({ where: { operationId: op.id, status: 'DELETED' } })).toBe(1)
    expect(await db!.artworkDedupClaim.count({ where: { operationId: op.id } })).toBe(2)
  })
  it('permits explicit generation CAS only after completion', async () => {
    const op = await prepared(),
      job = await start(op)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
    const completed = await current(op),
      source = await db!.artworkDedupSourceIdentity.findFirstOrThrow({
        where: { ownerOperationId: op.id, status: 'TOMBSTONE' }
      })
    await expect(
      db!.$transaction((tx) =>
        allowArtworkDedupDirectDeleteReimport(tx, {
          ...command(completed),
          sources: [{ sourceId: source.id, expectedGeneration: source.generation + 1n }]
        })
      )
    ).rejects.toMatchObject({ code: 'SOURCE_GENERATION_CHANGED' })
    await db!.$transaction((tx) =>
      allowArtworkDedupDirectDeleteReimport(tx, {
        ...command(completed),
        sources: [{ sourceId: source.id, expectedGeneration: source.generation }]
      })
    )
    expect(await db!.artworkDedupSourceIdentity.findUnique({ where: { id: source.id } })).toMatchObject({
      status: 'OPEN',
      generation: source.generation + 1n
    })
  })
  it('rolls back the first DB intent before any unlink and cancels hidden copies safely', async () => {
    const op = await prepared(),
      job = await start(op),
      context = executionContext<ArtworkDedupMaintenancePayload>(job)
    const mutate = context.mutateInTransaction
    context.mutateInTransaction = <TTransaction extends QueueSqlExecutor, TResult>(
      action: (transaction: TTransaction) => Promise<TResult>
    ) =>
      mutate<TTransaction, TResult>(async (transaction) => {
        const t = transaction as unknown as Prisma.TransactionClient
        const before = await t.artworkDedupFileReceipt.count({ where: { operationId: op.id } })
        const result = await action(transaction)
        const after = await t.artworkDedupFileReceipt.count({ where: { operationId: op.id } })
        if (after > before) throw new Error('synthetic database commit failure')
        return result
      })
    await executeArtworkDedupDirectDelete(context, deps())
    const failed = await current(op)
    expect(failed.deleteStartedAt).toBeNull()
    expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id } })).toBe(0)
    const files = await db!.artworkDedupOperationFile.findMany({ where: { operationId: op.id } })
    for (const file of files) expect((await fs.stat(path.join(root, file.canonicalPath))).isFile()).toBe(true)
    const stopping = await db!.$transaction((tx) => requestArtworkDedupDirectDeleteStop(tx, command(failed)))
    expect(stopping.jobId).toBeNull()
    const stopJob = await bind(stopping)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(stopJob), deps())
    expect((await current(op)).status).toBe('CANCELLED')
    expect(await db!.artworkDedupClaim.count({ where: { operationId: op.id } })).toBe(0)
    expect(
      await db!.artwork.count({
        where: { id: { in: [...new Set(files.map((f) => f.artworkId))] }, deletedAt: { not: null } }
      })
    ).toBe(0)
  })
  it('sends old queued execution stop and yields the writer until drain is true', async () => {
    const op = await prepared(['URL_ARCHIVE', 'URL_ARCHIVE'])
    const item = await db!.artworkDedupOperationArtwork.findFirstOrThrow({
      where: { operationId: op.id, role: 'COPY' }
    })
    const source = await db!.archiveImport.findFirstOrThrow({ where: { publishedArtworkId: item.artworkId } })
    const old = await db!.systemJob.create({
      data: {
        type: 'ARCHIVE_DOWNLOAD',
        executionLane: 'ARCHIVE_DOWNLOAD',
        triggerSource: 'SYSTEM',
        payload: { archiveImportId: source.id },
        availableAt: clock.now()
      }
    })
    trackMaintenanceJob(old.id)
    await db!.archiveImportExecution.create({ data: { jobId: old.id, archiveImportId: source.id, phase: 'DOWNLOAD' } })
    const job = await start(op)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
    expect((await current(op)).status).toBe('DRAINING')
    expect(await db!.systemJob.findUnique({ where: { id: old.id } })).toMatchObject({ status: 'CANCELLED' })
    expect(await db!.systemJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: 'RETRY_WAIT',
      leaseToken: null
    })
    expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id } })).toBe(0)
    clock.advance(3001)
    const continuation = await repository!.claim('drain-continuation', [
      { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 4, 5] }
    ])
    expect(continuation?.id).toBe(job.id)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(continuation!), deps())
    expect((await current(op)).status).toBe('DELETED')
  })
  it('makes progress across forced tiny fresh slices and reader restarts without early intent', async () => {
    const op = await prepared(['LOCAL_DIRECTORY', 'LOCAL_DIRECTORY'], 2)
    let job = await start(op),
      iterations = 0,
      sawFreshCursor = false
    while (iterations++ < 20) {
      await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), {
        ...deps(),
        sliceMs: 0
      })
      const observed = await current(op)
      if (observed.stage === 'FRESH') {
        sawFreshCursor ||= !!observed.afterFileId
        if (!observed.deleteStartedAt) {
          expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id } })).toBe(0)
        }
      }
      expect(observed.readerToken).toBeNull()
      if (observed.status === 'DELETED') break
      expect((await db!.systemJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('RETRY_WAIT')
      clock.advance(3001)
      job = (await repository!.claim('slice-continuation', [
        { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 4, 5] }
      ]))!
    }
    expect(sawFreshCursor).toBe(true)
    expect(iterations).toBeLessThan(20)
    expect((await current(op)).status).toBe('DELETED')
  }, 30000)
  it.each(['ISOLATION', 'PURGE'])('refuses old %s READY as direct delete authority', async (purpose) => {
    const op = await prepared()
    await db!.artworkDedupOperation.update({
      where: { id: op.id },
      data: { preparePurpose: purpose, protocolVersion: null, scopeDigest: null }
    })
    await expect(
      db!.$transaction((tx) => authorizeArtworkDedupDirectDelete(tx, confirmation(op)))
    ).rejects.toMatchObject({ code: 'DIRECT_DELETE_PROTOCOL_REQUIRED' })
    expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id } })).toBe(0)
  })
  it('invalidates the preview when title or organization structure changes', async () => {
    const op = await prepared(),
      item = await db!.artworkDedupOperationArtwork.findFirstOrThrow({ where: { operationId: op.id } })
    await db!.artwork.update({ where: { id: item.artworkId }, data: { title: 'changed title after preview' } })
    await expect(
      db!.$transaction((tx) => authorizeArtworkDedupDirectDelete(tx, confirmation(op)))
    ).rejects.toMatchObject({ code: 'STALE' })
  })
  it('refuses unknown attachments added after frozen preview without broadening scope', async () => {
    const op = await prepared(),
      copy = await db!.artworkDedupOperationArtwork.findFirstOrThrow({ where: { operationId: op.id, role: 'COPY' } })
    await fs.writeFile(path.join(root, copy.storagePath!, 'not-authorized.bin'), 'keep attachment')
    const job = await start(op)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), deps())
    expect((await current(op)).status).toBe('RECOVERY_REQUIRED')
    expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id } })).toBe(0)
    expect(await fs.readFile(path.join(root, copy.storagePath!, 'not-authorized.bin'), 'utf8')).toBe('keep attachment')
  })
  it('losing the original lease after intent prevents unlink and cannot release claims', async () => {
    const op = await prepared(),
      job = await start(op)
    await expect(
      executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(job), {
        ...deps(),
        onDirectDeleteBoundary: async (point) => {
          if (point === 'INTENT') {
            await db!.systemJob.update({ where: { id: job.id }, data: { leaseToken: randomUUID() } })
          }
        }
      })
    ).rejects.toBeDefined()
    expect(await db!.artworkDedupFileReceipt.count({ where: { operationId: op.id, status: 'COMPLETED' } })).toBe(0)
    const files = await db!.artworkDedupOperationFile.findMany({ where: { operationId: op.id } })
    for (const file of files) expect((await fs.stat(path.join(root, file.canonicalPath))).isFile()).toBe(true)
    expect(await db!.artworkDedupClaim.count({ where: { operationId: op.id } })).toBe(2)
    expect((await current(op)).readerToken).toBeNull()
    // This synthetic lease holder has no process; remove its scheduling eligibility for following fixtures.
    await db!.systemJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', workerId: null, leaseToken: null, leaseExpiresAt: null }
    })
    await db!.jobResourceLease.deleteMany({ where: { ownerJobId: job.id } })
  })
  it('a final DB commit failure keeps business records and HOLD then retries completed files', async () => {
    const op = await prepared(),
      job = await start(op),
      context = executionContext<ArtworkDedupMaintenancePayload>(job)
    const finalize = context.finalizeInTransaction
    context.finalizeInTransaction = <TTransaction extends QueueSqlExecutor>(
      action: (scope: FencedExecutionTransaction<TTransaction>) => Promise<void>
    ) =>
      finalize<TTransaction>(async (scope) => {
        const result = await action(scope)
        const t = scope.transaction as unknown as Prisma.TransactionClient
        if ((await t.artworkDedupOperation.findUniqueOrThrow({ where: { id: op.id } })).status === 'DELETED') {
          throw new Error('synthetic final commit failure')
        }
        return result
      })
    await expect(executeArtworkDedupDirectDelete(context, deps())).rejects.toThrow('synthetic final commit failure')
    const items = await db!.artworkDedupOperationArtwork.findMany({ where: { operationId: op.id } })
    expect(await db!.artwork.count({ where: { id: { in: items.map((i) => i.artworkId) } } })).toBe(2)
    expect(await db!.artworkDedupClaim.count({ where: { operationId: op.id } })).toBe(2)
    expect(
      await db!.artworkDedupSourceIdentity.count({ where: { ownerOperationId: op.id, status: 'TOMBSTONE' } })
    ).toBe(0)
    await repository!.fail({ ...fence(job), errorCode: 'INTERNAL_ERROR', error: 'synthetic final commit failure' })
    const retry = await start(await current(op), true)
    await executeArtworkDedupDirectDelete(executionContext<ArtworkDedupMaintenancePayload>(retry), deps())
    expect((await current(op)).status).toBe('DELETED')
  })
})
