// @vitest-environment node
import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Prisma, beginMediaContentPathWrite, withMediaContentOwnerPublication, type PrismaClient } from '@pixishelf/db'
import {
  JobExecutionFenceError,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type QueueSqlExecutor,
  type QueueDatabase,
  type ClaimedJob,
  type ExecutionContext,
  type EnqueuedChildJob
} from '@pixishelf/job-runtime'
import { type ArtworkBatchDeletePayload } from '@pixishelf/job-contracts'
import { executeArtworkBatchDelete } from '../../../pixishelf-job-executors/src/artwork-delete/batch-executor'
import { executeArchiveMaintenance } from '../../../pixishelf-job-executors/src/archive/maintenance-executor'
import { createDeletionContentContext } from '../../../pixishelf-job-executors/src/artwork-delete/content-context'
import { seedBatchDeleteFixture } from './artwork-batch-delete-fixture'
import { assertLegacyDedupDeletionSettled } from '../../../pixishelf-worker/src/dedup-deletion-upgrade-gate'
const settings = vi.hoisted(() => ({ root: '' }))
vi.mock('@/services/setting.service', () => ({ getScanPath: async () => settings.root }))
import { prisma } from '@/lib/prisma'
import {
  previewArtworkBatchDelete,
  submitArtworkBatchDelete,
  controlArtworkBatchDelete,
  getArtworkBatchDelete
} from '../artwork-batch-delete-service'
import { resolveArtworkDedupDeleteSelection, previewArtworkDedupBatchDelete } from '../artwork-dedup-delete-adapter'
import { resumeJobCommand, retryJobCommand, cancelJobCommand } from '../background-task/job-command-service'
import { prepareArtworkDedupCleanup, directDeleteArtworkDedupOperation } from '../artwork-dedup-review-service'
import { previewDeleteArtwork, deleteArtwork } from '../artwork-service/delete-artwork'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = prisma as unknown as PrismaClient
const repository = new PostgresQueueRepository(db as unknown as QueueDatabase, { transactionTimeoutMs: 20_000 })
const capability = [
  { jobType: 'ARTWORK_BATCH_DELETE' as const, executionLane: 'BACKGROUND_WRITER' as const, definitionVersions: [1] }
]
const fence = (job: ClaimedJob) => ({
  jobId: job.id,
  workerId: job.workerId,
  executionToken: job.executionToken,
  attempt: job.attempt
})
function context(
  job: ClaimedJob,
  signal = new AbortController().signal
): ExecutionContext<ArtworkBatchDeletePayload, EnqueuedChildJob> {
  return {
    job,
    payload: job.payload as ArtworkBatchDeletePayload,
    signal,
    progress: (update) => repository.updateProgress({ ...fence(job), ...update }),
    mutateInTransaction: (body) => repository.withFencedMutationTransaction(fence(job), body),
    enqueueChild: async () => {
      throw new Error('No child wait in writer lane')
    },
    finalizeInTransaction: async (body) => {
      await repository.withFencedExecutionTransaction(fence(job), body)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  }
}
async function runBatch(jobId: string, customize?: (ctx: ReturnType<typeof context>) => void) {
  const claimed = await repository.claim(`batch-fixture-${randomUUID()}`, capability)
  expect(claimed?.id).toBe(jobId)
  const ctx = context(claimed!)
  customize?.(ctx)
  const result = await executeArtworkBatchDelete(ctx, {
    database: db,
    sourceRoot: settings.root,
    archiveRoot: settings.root
  })
  if (result.kind === 'completed') {
    await repository.withFencedExecutionTransaction(fence(claimed!), (scope) =>
      scope.complete({ result: result.result, message: result.message })
    )
  }
  if (result.kind === 'cancelled') {
    await repository.withFencedExecutionTransaction(fence(claimed!), (scope) => scope.cancel(result.message))
  }
  return result
}
const confirmation = (batch: Awaited<ReturnType<typeof previewArtworkBatchDelete>>) => ({
  jobId: batch.jobId,
  items: batch.payload.items.map((item) => ({ artworkId: item.artworkId, selectedPaths: item.selectedPaths }))
})

describe.skipIf(!url).sequential('ordinary deletion shared with dedup, isolated PostgreSQL and files', () => {
  beforeAll(async () => {
    if (
      process.env.DATABASE_URL !== url ||
      new URL(url!).hostname !== '127.0.0.1' ||
      new URL(url!).port !== '56432' ||
      new URL(url!).pathname !== '/pixishelf_batch'
    ) {
      throw new Error('Use only the explicitly isolated batch fixture database')
    }
    await db.systemJob.updateMany({
      where: {
        requestedByUserId: { startsWith: 'batch-' },
        type: { in: ['ARTWORK_BATCH_DELETE', 'ARCHIVE_MAINTENANCE'] },
        status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'RETRY_WAIT'] }
      },
      data: { status: 'CANCELLED', workerId: null, leaseToken: null, leaseExpiresAt: null }
    })
    await db.jobResourceLease.deleteMany({
      where: { OR: [{ workerId: { startsWith: 'batch-fixture-' } }, { workerId: { startsWith: 'archive-fixture-' } }] }
    })
    settings.root = '/private/tmp/pixishelf-batch-delete-env/media'
    await fs.mkdir(settings.root, { recursive: true })
    process.env.ARCHIVE_STORAGE_PATH = settings.root
  })
  afterAll(async () => {
    await db.$disconnect()
  })

  it('mixes four sources and four relations; skips keeper originals during preview; persists selection and separates archive submission from movement', async () => {
    const f = await seedBatchDeleteFixture(db, settings.root)
    const keepers = f.groups.map((group) => group.files[0]!)
    for (const file of keepers) {
      await fs.rename(path.join(settings.root, file), path.join(settings.root, `${file}.unavailable`))
    }
    const prepared = await previewArtworkDedupBatchDelete(f.userId, { ...f.input, idempotencyKey: randomUUID() })
    for (const file of keepers) {
      await fs.rename(path.join(settings.root, `${file}.unavailable`), path.join(settings.root, file))
    }
    expect(prepared.payload.items).toHaveLength(4)
    expect(new Set(prepared.payload.items.map((item) => item.preview.artwork.createdVia)).size).toBe(4)
    expect(prepared.payload.origin?.losses?.some((loss) => loss.unmatched === '1' && loss.unchecked === '1')).toBe(true)
    expect(await db.artworkDedupOperation.count({ where: { runId: f.runId } })).toBe(0)
    expect(await db.artworkDedupClaim.count()).toBe(0)
    const input = { ...confirmation(prepared), expectedUserId: f.userId }
    const sidecar = input.items[0]!.selectedPaths.find((file) => file.endsWith('notes.txt'))!
    input.items[0]!.selectedPaths = input.items[0]!.selectedPaths.filter((file) => file !== sidecar)
    await submitArtworkBatchDelete(f.userId, input)
    await submitArtworkBatchDelete(f.userId, input)
    expect(await runBatch(prepared.jobId)).toMatchObject({ kind: 'completed' })
    const done = await getArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: prepared.jobId })
    expect(done.result.items.filter((item) => item.status === 'DELETED')).toHaveLength(3)
    expect(done.result.items.filter((item) => item.status === 'TRASH_SUBMITTED')).toHaveLength(1)
    expect(done.archives[0]?.status).toBe('PENDING')
    await expect(fs.readFile(path.join(settings.root, sidecar), 'utf8')).resolves.toContain('合成附属')
    for (const file of keepers) {
      expect(
        createHash('sha256')
          .update(await fs.readFile(path.join(settings.root, file)))
          .digest('hex')
      ).toBe(f.files.get(file))
    }
    const archive = await repository.claim(`archive-fixture-${randomUUID()}`, [
      { jobType: 'ARCHIVE_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [2] }
    ])
    expect(archive?.id).toBe(done.archives[0]?.id)
    const ctx = { ...context(archive!), payload: archive!.payload }
    await executeArchiveMaintenance(ctx as never, {
      database: db,
      config: { scanRoot: settings.root, sourceMediaRoot: settings.root }
    })
    const recycled = await getArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: prepared.jobId })
    expect(recycled.archives[0]?.status).toBe('COMPLETED')
    const target = await db.artwork.findUniqueOrThrow({
      where: { id: f.groups[2]!.target },
      include: { archiveRevisions: true }
    })
    expect(target.archiveLifecycleState).toBe('TRASHED')
    expect(target.archiveRevisions[0]!.purgeAfter!.getTime() - target.deletedAt!.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000
    )
    expect(
      await db.archiveStagingGeneration.count({ where: { archiveImport: { publishedArtworkId: target.id } } })
    ).toBe(0)
    await db.systemJob.update({
      where: { id: prepared.jobId },
      data: { result: { items: done.result.items.filter((item) => item.status !== 'TRASH_SUBMITTED') } }
    })
    await controlArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: prepared.jobId }, 'RETRY')
    await runBatch(prepared.jobId)
    const replay = await getArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: prepared.jobId })
    expect(replay.result.items.find((item) => item.artworkId === target.id)?.message).toBe('文件已移入回收站')
  }, 30_000)

  it('resolves across pages, never recommends manual pairs, deduplicates targets and reports the precise keeper/delete conflict', async () => {
    const f = await seedBatchDeleteFixture(db, settings.root, { extraGroups: 20 })
    const all = await resolveArtworkDedupDeleteSelection(f.userId, {
      ...f.input,
      selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [], manualGroupIds: [] }
    })
    expect(all.groupIds).toHaveLength(22)
    const mixed = await resolveArtworkDedupDeleteSelection(f.userId, {
      ...f.input,
      selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [], manualGroupIds: [f.groups[2]!.groupId] }
    })
    expect(mixed.groupIds).toHaveLength(23)
    const pair = f.groups[3]!
    await db.artworkDedupReview.delete({
      where: { runId_userId_groupId: { runId: f.runId, userId: f.userId, groupId: pair.groupId } }
    })
    await expect(
      resolveArtworkDedupDeleteSelection(f.userId, {
        ...f.input,
        selection: { kind: 'EXPLICIT', groupIds: [pair.groupId] }
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    const duplicate = `${randomUUID()}`
    await db.artworkDedupRelation.create({
      data: {
        id: duplicate,
        runId: f.runId,
        containedArtworkId: f.groups[0]!.target,
        containerArtworkId: f.groups[1]!.keeper,
        containedFileCount: 1n,
        containerFileCount: 2n
      }
    })
    const same = await resolveArtworkDedupDeleteSelection(f.userId, {
      ...f.input,
      selection: { kind: 'EXPLICIT', groupIds: [f.groups[0]!.groupId, duplicate] }
    })
    expect(same.artworkIds).toEqual([f.groups[0]!.target])
    await db.artworkDedupRelation.create({
      data: {
        id: `${duplicate}-conflict`,
        runId: f.runId,
        containedArtworkId: f.groups[0]!.keeper,
        containerArtworkId: f.groups[1]!.keeper,
        containedFileCount: 1n,
        containerFileCount: 2n
      }
    })
    await expect(
      resolveArtworkDedupDeleteSelection(f.userId, {
        ...f.input,
        selection: { kind: 'EXPLICIT', groupIds: [f.groups[0]!.groupId, `${duplicate}-conflict`] }
      })
    ).rejects.toThrow(`#${f.groups[0]!.keeper}`)
  }, 30_000)

  it('blocks generic resume/retry/cancel and old prepare/delete; cancellation before submit deletes nothing', async () => {
    const f = await seedBatchDeleteFixture(db, settings.root)
    const batch = await previewArtworkBatchDelete(f.userId, {
      expectedUserId: f.userId,
      artworkIds: [f.groups[0]!.target],
      idempotencyKey: randomUUID()
    })
    for (const command of [resumeJobCommand, retryJobCommand, cancelJobCommand]) {
      await expect(command({ jobId: batch.jobId })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    }
    await expect(
      prepareArtworkDedupCleanup(f.userId, { ...f.input, idempotencyKey: randomUUID() })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(directDeleteArtworkDedupOperation(f.userId, {} as never)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await controlArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: batch.jobId }, 'STOP')
    await expect(
      submitArtworkBatchDelete(f.userId, { ...confirmation(batch), expectedUserId: f.userId })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await db.artwork.count({ where: { id: f.groups[0]!.target } })).toBe(1)
  })

  it('continues independent items after a missing target; retries only failures with stable operation IDs; stops subsequent items at a work boundary', async () => {
    const f = await seedBatchDeleteFixture(db, settings.root)
    const targets = [f.groups[0]!.target, f.groups[1]!.target, f.groups[3]!.target]
    const batch = await previewArtworkBatchDelete(f.userId, {
      expectedUserId: f.userId,
      artworkIds: targets,
      idempotencyKey: randomUUID()
    })
    await submitArtworkBatchDelete(f.userId, { ...confirmation(batch), expectedUserId: f.userId })
    await db.artwork.delete({ where: { id: targets[0] } })
    await runBatch(batch.jobId, (ctx) => {
      const progress = ctx.progress
      let n = 0
      ctx.progress = async (update) => {
        await progress(update)
        if (update.stage === 'DELETING' && ++n === 2) {
          await controlArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: batch.jobId }, 'STOP')
        }
      }
    })
    const stopped = await getArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: batch.jobId })
    expect(stopped.status).toBe('CANCELLED')
    expect(stopped.result.items.map((item) => item.status)).toEqual(['FAILED', 'DELETED'])
    expect(await db.artwork.count({ where: { id: targets[2] } })).toBe(1)
    await controlArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: batch.jobId }, 'RETRY')
    await runBatch(batch.jobId)
    const done = await getArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: batch.jobId })
    expect(done.result.items.filter((item) => item.status === 'DELETED')).toHaveLength(2)
    expect(done.payload.items.map((item) => item.operationId)).toEqual(
      batch.payload.items.map((item) => item.operationId)
    )
  }, 30_000)

  it('refuses an actual writer, retains the original manifest scope on retry, and refuses changed files', async () => {
    const f = await seedBatchDeleteFixture(db, settings.root)
    const target = f.groups[0]!.target
    const batch = await previewArtworkBatchDelete(f.userId, {
      expectedUserId: f.userId,
      artworkIds: [target],
      idempotencyKey: randomUUID()
    })
    await submitArtworkBatchDelete(f.userId, { ...confirmation(batch), expectedUserId: f.userId })
    const owner = { ownerUserId: f.userId, sessionId: randomUUID(), sessionVersion: 1n, execution: null }
    const writeToken = randomUUID()
    const content = await createDeletionContentContext(db, settings.root).resolveContentPath(
      settings.root,
      f.groups[0]!.files[1]!
    )
    const declaration = await db.$transaction((tx) =>
      beginMediaContentPathWrite(tx, {
        directory: content.directory,
        scope: { kind: 'PATH', relativePath: content.relativePath },
        owner,
        writeToken,
        parent: null,
        upload: null,
        now: new Date()
      })
    )
    if (declaration.status !== 'READY') throw new Error(declaration.status)
    await runBatch(batch.jobId)
    const failed = await getArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: batch.jobId })
    expect(failed.result.items[0]!.status).toBe('FAILED')
    expect(failed.result.items[0]!.message).toContain('作品正在写入')
    await db.$transaction((tx) =>
      withMediaContentOwnerPublication(
        tx,
        { owner, handles: [declaration.value], outcome: 'verified-rollback', now: new Date() },
        async () => undefined
      )
    )
    const folder = path.dirname(content.absolutePath)
    await fs.writeFile(path.join(folder, 'later.txt'), '不在原确认范围')
    await fs.writeFile(path.join(folder, 'notes.txt'), '已改变的附属文件')
    await controlArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: batch.jobId }, 'RETRY')
    await runBatch(batch.jobId)
    const changed = await getArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: batch.jobId })
    expect(changed.result.items[0]!.status).toBe('FAILED')
    expect(changed.result.items[0]!.message).toContain('身份已变化')
    expect(await fs.readFile(path.join(folder, 'later.txt'), 'utf8')).toBe('不在原确认范围')
    expect(await db.artwork.count({ where: { id: target } })).toBe(1)
  }, 30_000)

  it('stops on shutdown at a file boundary, releases the ordinary file lock, and resumes only the original operation after worker restart', async () => {
    const f = await seedBatchDeleteFixture(db, settings.root)
    const batch = await previewArtworkBatchDelete(f.userId, {
      expectedUserId: f.userId,
      artworkIds: [f.groups[1]!.target],
      idempotencyKey: randomUUID()
    })
    await submitArtworkBatchDelete(f.userId, { ...confirmation(batch), expectedUserId: f.userId })
    const job = await repository.claim(`batch-fixture-${randomUUID()}`, capability)
    expect(job?.id).toBe(batch.jobId)
    const controller = new AbortController()
    const ctx = context(job!, controller.signal)
    const original = fs.unlink.bind(fs)
    let removed = 0
    const unlink = vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
      await original(file)
      removed++
      controller.abort(new Error('fixture-worker-shutdown'))
    })
    try {
      await expect(
        executeArtworkBatchDelete(ctx, { database: db, sourceRoot: settings.root, archiveRoot: settings.root })
      ).rejects.toThrow('fixture-worker-shutdown')
    } finally {
      unlink.mockRestore()
    }
    expect(removed).toBe(1)
    await expect(
      fs.stat(
        path.join(
          settings.root,
          '.pixishelf-upload-recovery',
          'deletions',
          `artwork-${f.groups[1]!.target}`,
          '.replace-write-lock'
        )
      )
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await repository.withFencedExecutionTransaction(fence(job!), (scope) => scope.release('隔离 Worker 正常关闭'))
    await runBatch(batch.jobId)
    const done = await getArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: batch.jobId })
    expect(done.result.items[0]!.status).toBe('DELETED')
    expect(done.payload.items[0]!.operationId).toBe(batch.payload.items[0]!.operationId)
  }, 30_000)

  it('rejects different scopes racing for the same preview key and allows pure historical failure through the upgrade gate', async () => {
    const f = await seedBatchDeleteFixture(db, settings.root)
    const idempotencyKey = randomUUID()
    const outcomes = await Promise.allSettled(
      [f.groups[0]!.target, f.groups[1]!.target].map((id) =>
        previewArtworkBatchDelete(f.userId, { expectedUserId: f.userId, artworkIds: [id], idempotencyKey })
      )
    )
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((item) => item.status === 'rejected')).toHaveLength(1)
    const history = await db.artworkDedupOperation.create({
      data: {
        runId: f.runId,
        artistId: f.artistId,
        requestedBy: f.userId,
        idempotencyKey: randomUUID(),
        requestDigest: 'a'.repeat(64),
        runVersion: 1,
        frozenReviewRevision: 0,
        selectionKind: 'EXPLICIT',
        status: 'FAILED'
      }
    })
    await expect(assertLegacyDedupDeletionSettled(db)).resolves.toBeUndefined()
    await db.artworkDedupOperation.update({
      where: { id: history.id },
      data: { status: 'RECOVERY_REQUIRED', movedFiles: 1n }
    })
    await expect(assertLegacyDedupDeletionSettled(db)).rejects.toThrow('previous version')
    await db.artworkDedupOperation.delete({ where: { id: history.id } })
  })

  it('fences the first file action after real lease expiry without deleting an original', async () => {
    const f = await seedBatchDeleteFixture(db, settings.root)
    const target = f.groups[0]!
    const batch = await previewArtworkBatchDelete(f.userId, {
      expectedUserId: f.userId,
      artworkIds: [target.target],
      idempotencyKey: randomUUID()
    })
    await submitArtworkBatchDelete(f.userId, { ...confirmation(batch), expectedUserId: f.userId })
    const job = await repository.claim(`batch-fixture-${randomUUID()}`, capability)
    expect(job?.id).toBe(batch.jobId)
    const ctx = context(job!)
    const progress = ctx.progress
    ctx.progress = async (update) => {
      await progress(update)
      if (update.stage === 'DELETING') {
        const expiredAt = new Date(Date.now() - 1)
        await db.systemJob.update({ where: { id: job!.id }, data: { leaseExpiresAt: expiredAt } })
        await db.jobResourceLease.updateMany({ where: { ownerJobId: job!.id }, data: { expiresAt: expiredAt } })
      }
    }
    await expect(
      executeArtworkBatchDelete(ctx, { database: db, sourceRoot: settings.root, archiveRoot: settings.root })
    ).rejects.toBeInstanceOf(JobExecutionFenceError)
    expect(
      createHash('sha256')
        .update(await fs.readFile(path.join(settings.root, target.files[1]!)))
        .digest('hex')
    ).toBe(f.files.get(target.files[1]!))
    expect(await db.artwork.count({ where: { id: target.target } })).toBe(1)
    // The queue itself reclaims the expired synthetic execution; cancel before it performs any work.
    const recovered = await repository.claim(`batch-fixture-${randomUUID()}`, capability)
    expect(recovered?.id).toBe(batch.jobId)
    await repository.withFencedExecutionTransaction(fence(recovered!), (scope) =>
      scope.cancel('Zero-file lease-loss fixture finished')
    )
  }, 30_000)

  it('rolls back database publication after files are removed and resumes the original operation without repeated unlink or counts', async () => {
    const f = await seedBatchDeleteFixture(db, settings.root)
    const target = f.groups[1]!.target
    const batch = await previewArtworkBatchDelete(f.userId, {
      expectedUserId: f.userId,
      artworkIds: [target],
      idempotencyKey: randomUUID()
    })
    await submitArtworkBatchDelete(f.userId, { ...confirmation(batch), expectedUserId: f.userId })
    let injected = false
    await runBatch(batch.jobId, (ctx) => {
      const mutate = ctx.mutateInTransaction
      ctx.mutateInTransaction = <TTransaction extends QueueSqlExecutor, TResult>(
        body: (tx: TTransaction) => Promise<TResult>
      ) =>
        mutate<TTransaction, TResult>(async (tx) => {
          const value = await body(tx)
          const current = await (tx as unknown as Prisma.TransactionClient).artwork.count({ where: { id: target } })
          if (!current && !injected) {
            injected = true
            throw new Error('fixture-publication-rollback')
          }
          return value
        })
    })
    expect(injected).toBe(true)
    expect(await db.artwork.count({ where: { id: target } })).toBe(1)
    await expect(fs.stat(path.join(settings.root, f.groups[1]!.files[1]!))).rejects.toMatchObject({ code: 'ENOENT' })
    await controlArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: batch.jobId }, 'RETRY')
    const unlink = vi.spyOn(fs, 'unlink')
    try {
      await runBatch(batch.jobId)
      expect(unlink).not.toHaveBeenCalled()
    } finally {
      unlink.mockRestore()
    }
    const done = await getArtworkBatchDelete(f.userId, { expectedUserId: f.userId, jobId: batch.jobId })
    expect(done.payload.items[0]!.operationId).toBe(batch.payload.items[0]!.operationId)
    expect(done.result.items[0]!.report?.counts.media).toBe(1)
    expect(done.result.items[0]!.report?.database.deletedMediaCount).toBe(1)
    expect(await db.artwork.count({ where: { id: target } })).toBe(0)
  }, 30_000)

  it('records preparation, queue, files and database timing for equivalent ordinary and dedup fixtures without reading originals again', async () => {
    const baseline = await seedBatchDeleteFixture(db, settings.root)
    const normal = {
      previewMs: 0,
      executionMs: 0,
      transactions: 0,
      phasesMs: { PREPARATION: 0, FILES: 0, DATABASE: 0 },
      imageContentReads: 0,
      unlinks: 0
    }
    const readFile = fs.readFile.bind(fs),
      unlink = fs.unlink.bind(fs),
      open = fs.open.bind(fs)
    let counters = normal
    const readSpy = vi.spyOn(fs, 'readFile').mockImplementation((...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]).endsWith('.png')) counters.imageContentReads++
      return readFile(...args)
    })
    const openSpy = vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]).endsWith('.png')) counters.imageContentReads++
      return open(...args)
    })
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
      counters.unlinks++
      await unlink(file)
    })
    try {
      for (const group of baseline.groups) {
        let at = performance.now()
        const preview = await previewDeleteArtwork(group.target, baseline.userId)
        normal.previewMs += performance.now() - at
        at = performance.now()
        const report = await deleteArtwork(
          {
            artworkId: group.target,
            operationId: preview.operationId ?? randomUUID(),
            selectedPaths: preview.entries
              .filter((entry) => ['REQUIRED', 'OPTIONAL'].includes(entry.selection))
              .map((entry) => entry.path)
          },
          {
            requestedByUserId: baseline.userId,
            control: {
              checkExecution() {},
              transaction: async (body) => {
                normal.transactions++
                return db.$transaction(body)
              },
              observe: (phase, ms) => {
                normal.phasesMs[phase] += ms
              }
            }
          }
        )
        normal.executionMs += performance.now() - at
        if (report.mode === 'ARCHIVE_TRASH') normal.transactions++
        expect(['COMPLETED', 'QUEUED']).toContain(report.outcome)
      }
      const candidate = await seedBatchDeleteFixture(db, settings.root)
      expect([...candidate.files.values()].sort()).toEqual([...baseline.files.values()].sort())
      const batchTiming = {
        previewMs: 0,
        executionMs: 0,
        transactions: 0,
        phasesMs: { PREPARATION: 0, FILES: 0, DATABASE: 0 },
        imageContentReads: 0,
        unlinks: 0,
        queueMs: 0
      }
      counters = batchTiming
      let at = performance.now()
      const batch = await previewArtworkDedupBatchDelete(candidate.userId, {
        ...candidate.input,
        idempotencyKey: randomUUID()
      })
      batchTiming.previewMs = performance.now() - at
      await submitArtworkBatchDelete(candidate.userId, { ...confirmation(batch), expectedUserId: candidate.userId })
      at = performance.now()
      await runBatch(batch.jobId, (ctx) => {
        const mutate = ctx.mutateInTransaction
        ctx.mutateInTransaction = async (body) => {
          batchTiming.transactions++
          return mutate(body)
        }
        batchTiming.queueMs = Date.now() - new Date(ctx.job.availableAt).getTime()
        ctx.logger.info = (_message, data) => {
          const timing = data as { phasesMs?: typeof batchTiming.phasesMs }
          if (timing?.phasesMs) {
            for (const phase of ['PREPARATION', 'FILES', 'DATABASE'] as const) {
              batchTiming.phasesMs[phase] += timing.phasesMs[phase] ?? 0
            }
          }
        }
      })
      batchTiming.executionMs = performance.now() - at
      expect(normal.imageContentReads).toBe(0)
      expect(batchTiming.imageContentReads).toBe(0)
      expect(batchTiming.unlinks).toBe(normal.unlinks)
      await fs.writeFile(
        '/private/tmp/pixishelf-batch-delete-env/timing.json',
        JSON.stringify(
          {
            environment: 'isolated PostgreSQL; local SSD; synthetic 4-source/4-relation equivalent fixtures',
            normal,
            batch: batchTiming,
            note: 'No NAS latency claim; queue delay is local test dispatch. File phase retains ordinary per-file fsync/manifest behavior.'
          },
          null,
          2
        )
      )
    } finally {
      readSpy.mockRestore()
      openSpy.mockRestore()
      unlinkSpy.mockRestore()
    }
  }, 30_000)
})
