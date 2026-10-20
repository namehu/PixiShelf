import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import type { Prisma, PrismaClient } from '@pixishelf/db'
import type { ArchiveImportV2Payload, ArchiveResolveItemPayload } from '@pixishelf/job-contracts'
import {
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type QueueDatabase,
  type QueueSqlExecutor
} from '@pixishelf/job-runtime'
import {
  executeArchiveImport,
  executeArchiveResolveItem,
  type ArchiveProvider,
  type ResolvedArchive
} from '@pixishelf/job-executors'
import { expect, vi } from 'vitest'
import { createArchiveIntakeSubmission } from '../archive-intake-service'

// Real executors, transactions, queue fencing and media storage; only the remote Provider is controlled.
export async function runConcurrentArchiveTasks(
  database: PrismaClient,
  requestedByUserId: string,
  phase: 'transfer' | 'checkpoint' | 'publication',
  submit: () => Promise<void>
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-intake-workers-'))
  const resolverGate = gate()
  const writerGate = gate()
  const repository = new PostgresQueueRepository(database as unknown as QueueDatabase, {
    leaseDurationMs: 120_000,
    transactionTimeoutMs: 30_000,
    transactionMaxWaitMs: 5_000
  })
  const picture = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#5588aa' } })
    .png()
    .toBuffer()
  const downloadIdentity = randomUUID()
  const resolveIdentity = randomUUID()
  const title = `intake-worker-${downloadIdentity}`
  let armed = false
  const provider: ArchiveProvider = {
    key: 'e-hentai',
    requestGovernance: 'PER_REQUEST',
    accepts: () => true,
    resolve: async (url) => {
      if (armed && phase !== 'checkpoint') await resolverGate.hold()
      return resolved(url, title)
    },
    openMedia: async () => {
      if (phase === 'transfer') await writerGate.hold()
      return {
        stream: Readable.from([picture]),
        contentLength: picture.length,
        mimeType: 'image/png',
        originalFilename: '0001.png',
        quality: 'ORIGINAL',
        remoteHost: 'fixture.invalid'
      }
    }
  }
  const providers = { get: () => provider, getForUrl: () => provider }
  const seed = async (identity: string) => {
    const submission = await createArchiveIntakeSubmission(
      {
        idempotencyKey: randomUUID(),
        urls: [`https://e-hentai.org/g/${identity}/fixture/`],
        downloadMode: 'AUTO'
      },
      requestedByUserId,
      { database }
    )
    const item = submission.items[0]!
    await database.systemJob.update({
      where: { id: item.currentSystemJobId! },
      data: { queuePriority: 0, effectivePriority: 0 }
    })
    const claimed = await repository.claim(`fixture-${identity}`, [
      { jobType: 'ARCHIVE_RESOLVE_ITEM', executionLane: 'ARCHIVE_RESOLVE', definitionVersions: [1] }
    ])
    expect(claimed?.id).toBe(item.currentSystemJobId)
    return { item, claimed: claimed! }
  }

  let running: Promise<unknown>[] = []
  try {
    const downloadSeed = await seed(downloadIdentity)
    await executeArchiveResolveItem(context<ArchiveResolveItemPayload>(downloadSeed.claimed, repository), {
      database,
      providers
    })
    const intake = await database.archiveIntakeItem.findUniqueOrThrow({ where: { id: downloadSeed.item.id } })
    expect(intake.status).toBe('ENQUEUED')
    const archive = await database.archiveImport.findUniqueOrThrow({ where: { id: intake.archiveImportId! } })
    await database.systemJob.update({
      where: { id: archive.systemJobId },
      data: { queuePriority: 0, effectivePriority: 0 }
    })
    const writer = await repository.claim(`writer-${downloadIdentity}`, [
      { jobType: 'ARCHIVE_IMPORT', executionLane: 'BACKGROUND_WRITER', definitionVersions: [2] }
    ])
    expect(writer?.id).toBe(archive.systemJobId)
    const resolving = await seed(resolveIdentity)
    armed = true
    const resolverContext = context<ArchiveResolveItemPayload>(resolving.claimed, repository)
    const writerContext = context<ArchiveImportV2Payload>(writer!, repository)

    if (phase === 'checkpoint') {
      const finalize = resolverContext.finalizeInTransaction
      resolverContext.finalizeInTransaction = (operation) =>
        finalize<Parameters<typeof operation>[0]['transaction']>(async (scope) => {
          await operation(scope)
          await resolverGate.hold()
        })
      const mutate = writerContext.mutateInTransaction
      writerContext.mutateInTransaction = <T extends QueueSqlExecutor, R>(operation: (tx: T) => Promise<R>) =>
        mutate<T, R>(async (tx) => {
          const result = await operation(tx)
          const completed = await (tx as unknown as Prisma.TransactionClient).archiveImportItem.count({
            where: { archiveImportId: archive.id, status: 'COMPLETED' }
          })
          if (completed > 0) await writerGate.hold()
          return result
        })
    }
    if (phase === 'publication') {
      const finalize = writerContext.finalizeInTransaction
      writerContext.finalizeInTransaction = (operation) =>
        finalize<Parameters<typeof operation>[0]['transaction']>(async (scope) => {
          await operation(scope)
          await writerGate.hold()
        })
    }
    running = [
      executeArchiveResolveItem(resolverContext, { database, providers }),
      executeArchiveImport(writerContext, { database, providers, config: { scanRoot: root, mediaConcurrency: 1 } })
    ]
    // Attach rejection handlers immediately so fixture failures cannot become unhandled rejections.
    const completion = Promise.all(running)
    void completion.catch(() => undefined)
    await Promise.race([
      Promise.all([resolverGate.entered, writerGate.entered]),
      completion.then(() => {
        throw new Error('Workers completed before the concurrency gates')
      })
    ])
    expect(
      await database.systemJob.count({
        where: { id: { in: [resolving.claimed.id, writer!.id] }, status: 'RUNNING' }
      })
    ).toBe(2)
    const submission = submit()
    void submission.catch(() => undefined)
    if (phase !== 'transfer') {
      // system_jobs' artist-command trigger shares the creator catalog lock with
      // resolution/publication, even for unrelated galleries. Model a finite
      // Worker transaction: observe the blocked INSERT, then let it commit.
      await vi.waitFor(
        async () => {
          const waiting = await database.$queryRawUnsafe<Array<{ count: bigint }>>(`
          SELECT count(*) FROM pg_stat_activity
          WHERE application_name LIKE 'intake-batch-%-request'
            AND wait_event_type = 'Lock' AND wait_event = 'advisory'
            AND cardinality(pg_blocking_pids(pid)) > 0
        `)
          expect(Number(waiting[0]?.count)).toBeGreaterThan(0)
        },
        { timeout: 5_000, interval: 25 }
      )
    }
    resolverGate.release()
    writerGate.release()
    await submission
    await completion
    expect(
      await database.systemJob.count({
        where: { id: { in: [resolving.claimed.id, writer!.id] }, status: 'COMPLETED' }
      })
    ).toBe(2)
    expect(await database.archiveImport.findUniqueOrThrow({ where: { id: archive.id } })).toMatchObject({
      status: 'COMPLETED',
      completedItems: 1,
      failedItems: 0
    })
    expect(await database.archiveIntakeItem.findUniqueOrThrow({ where: { id: resolving.item.id } })).toMatchObject({
      status: 'ENQUEUED'
    })
  } finally {
    resolverGate.release()
    writerGate.release()
    await Promise.allSettled(running)
    await database.archiveIntakeSubmission.deleteMany({
      where: {
        requestedByUserId,
        items: {
          some: {
            submittedUrl: {
              in: [
                `https://e-hentai.org/g/${downloadIdentity}/fixture/`,
                `https://e-hentai.org/g/${resolveIdentity}/fixture/`
              ]
            }
          }
        }
      }
    })
    await database.archiveImport.deleteMany({
      where: { providerKey: 'e-hentai', externalId: { in: [downloadIdentity, resolveIdentity] } }
    })
    await database.artwork.deleteMany({ where: { title } })
    await removeFixtureDirectory(root)
  }
}

async function removeFixtureDirectory(root: string) {
  const resolvedRoot = path.resolve(root)
  if (!resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture directory')
  await rm(resolvedRoot, { recursive: true, force: true })
}

function context<T>(job: ClaimedJob, repository: PostgresQueueRepository): ExecutionContext<T, EnqueuedChildJob> {
  const fence = { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
  return {
    job,
    payload: job.payload as T,
    signal: new AbortController().signal,
    progress: (update) => repository.updateProgress({ ...fence, ...update }),
    enqueueChild: async () => {
      throw new Error('Unexpected child enqueue')
    },
    mutateInTransaction: (operation) => repository.withFencedMutationTransaction(fence, operation),
    finalizeInTransaction: async (operation) => {
      await repository.withFencedExecutionTransaction(fence, operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
}

function gate() {
  let notify!: () => void
  let release!: () => void
  const entered = new Promise<void>((done) => {
    notify = done
  })
  const released = new Promise<void>((done) => {
    release = done
  })
  return {
    entered,
    release,
    hold: async () => {
      notify()
      await released
    }
  }
}

function resolved(url: string, title: string): ResolvedArchive {
  return {
    providerKey: 'e-hentai',
    externalId: new URL(url).pathname.split('/')[2]!,
    canonicalUrl: url,
    locator: {},
    title,
    titleAliases: [],
    description: null,
    category: null,
    uploader: null,
    thumbnailUrl: null,
    postedAt: null,
    tags: [],
    relationships: [],
    media: [{ index: 0, sourcePageUrl: 'https://fixture.invalid/page/1', locator: {}, expectedFilename: '0001.png' }],
    normalizedMetadata: { titles: { display: title }, fileCount: 1, tags: [], relationships: [] },
    rawMetadata: {},
    warnings: [],
    creatorBucket: '_unknown'
  }
}
