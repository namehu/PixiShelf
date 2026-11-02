import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { PostgresQueueRepository, type QueueDatabase, type ExecutionContext, type EnqueuedChildJob } from '@pixishelf/job-runtime'
import type { ArchiveImportV2Payload } from '@pixishelf/job-contracts'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { captureArchiveFixtureSource } from './dedup-source-fixture'
import { startArchiveImport } from '../executor'
import type { ArchiveExecutorDependencies } from '../types'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const suite = url ? describe : describe.skip
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `preparation-regression-${randomUUID()}`
const repo = db ? new PostgresQueueRepository(db as unknown as QueueDatabase) : null

suite('download preparation real transaction recovery', () => {
  afterAll(async () => {
    if (!db) return
    await db.archiveImport.deleteMany({ where: { id: prefix } })
    await db.artworkDedupSourceIdentity.deleteMany({ where: { providerKey: 'test', externalId: prefix } })
    await db.jobResourceLease.deleteMany({ where: { ownerJobId: prefix } })
    await db.systemJob.deleteMany({ where: { id: prefix } })
    await db.$disconnect()
  })

  it('rolls back intent consumption, then preserves new failures across a repeated start', async () => {
    await db!.systemJob.create({ data: { id: prefix, type: 'ARCHIVE_DOWNLOAD', executionLane: 'ARCHIVE_DOWNLOAD', triggerSource: 'MANUAL', queuePriority: 10, effectivePriority: 10, payload: { archiveImportId: prefix, defaultTagIds: [] } } })
    await db!.archiveImport.create({ data: {
      id: prefix, systemJobId: prefix, phase: 'DOWNLOAD', origin: 'MANUAL', providerKey: 'test', externalId: prefix,
      dedupSourceSnapshot: await captureArchiveFixtureSource(db!, 'test', prefix), submittedUrl: 'https://example.test',
      canonicalUrl: 'https://example.test', locator: {}, normalizedMetadata: {}, rawMetadata: {}, metadataHash: 'a'.repeat(64),
      creatorBucket: 'bucket', stagingPath: `.archive-staging/${prefix}`, totalItems: 2, failedItems: 2,
      executions: { create: { jobId: prefix, phase: 'DOWNLOAD', pendingDownloadPreparation: { scope: 'ALL_INCOMPLETE' } } },
      items: { create: [0, 1].map((pageIndex) => ({ pageIndex, sourcePageUrl: 'https://example.test/image', locator: {}, expectedFilename: `${pageIndex}.png`, status: 'FAILED' as const, attempts: 3, errorCode: 'REMOTE_RESPONSE_INVALID' })) }
    } })
    const job = await repo!.claim(`${prefix}-worker`, [{ jobType: 'ARCHIVE_DOWNLOAD', executionLane: 'ARCHIVE_DOWNLOAD', definitionVersions: [1] }])
    expect(job).not.toBeNull()
    const fence = { jobId: job!.id, workerId: job!.workerId, executionToken: job!.executionToken, attempt: job!.attempt }
    const ctx = {
      job: job!, payload: job!.payload as ArchiveImportV2Payload, signal: new AbortController().signal,
      progress: vi.fn(), enqueueChild: vi.fn(), finalizeInTransaction: vi.fn(),
      mutateInTransaction: (operation: (tx: never) => Promise<unknown>) => repo!.withFencedMutationTransaction(fence, operation),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    } as unknown as ExecutionContext<ArchiveImportV2Payload, EnqueuedChildJob>
    const dependencies = { database: db!, config: { scanRoot: '/tmp', mediaConcurrency: 1 }, providers: { get: vi.fn() } } as unknown as ArchiveExecutorDependencies
    const failCtx = { ...ctx, mutateInTransaction: ((operation: (tx: never) => Promise<unknown>) => repo!.withFencedMutationTransaction(fence, async (tx) => { await operation(tx as never); throw new Error('injected before commit') })) as typeof ctx.mutateInTransaction }
    await expect(startArchiveImport(failCtx, dependencies, new Date())).rejects.toThrow('injected before commit')
    expect((await db!.archiveImportExecution.findUniqueOrThrow({ where: { jobId: prefix } })).pendingDownloadPreparation).toEqual({ scope: 'ALL_INCOMPLETE' })
    expect(await db!.archiveImportItem.count({ where: { archiveImportId: prefix, status: 'FAILED', attempts: 3 } })).toBe(2)
    await startArchiveImport(ctx, dependencies, new Date())
    expect((await db!.archiveImportExecution.findUniqueOrThrow({ where: { jobId: prefix } })).pendingDownloadPreparation).toBeNull()
    const item = await db!.archiveImportItem.findFirstOrThrow({ where: { archiveImportId: prefix }, orderBy: { pageIndex: 'asc' } })
    await db!.archiveImportItem.update({ where: { id: item.id }, data: { status: 'FAILED', attempts: 1, errorCode: 'NEW_FAILURE' } })
    const restarted = await startArchiveImport(ctx, dependencies, new Date())
    expect(restarted.archiveImport.items[0]).toMatchObject({ status: 'FAILED', attempts: 1, errorCode: 'NEW_FAILURE' })
    expect(restarted.archiveImport.failedItems).toBe(1)
    const other = restarted.archiveImport.items[1]!
    await db!.archiveImportItem.update({ where: { id: other.id }, data: { status: 'FAILED', attempts: 2, errorCode: 'OTHER_FAILURE', errorMessage: 'other diagnostic' } })
    await db!.archiveImportExecution.update({ where: { jobId: prefix }, data: { pendingDownloadPreparation: { scope: 'ITEM', itemId: item.id } } })
    const single = await startArchiveImport(ctx, dependencies, new Date())
    expect(single.archiveImport.items[0]).toMatchObject({ status: 'PENDING', attempts: 0, errorCode: null })
    expect(single.archiveImport.items[1]).toMatchObject({ status: 'FAILED', attempts: 2, errorCode: 'OTHER_FAILURE', errorMessage: 'other diagnostic' })
    expect(single.archiveImport.failedItems).toBe(1)
  })
})
