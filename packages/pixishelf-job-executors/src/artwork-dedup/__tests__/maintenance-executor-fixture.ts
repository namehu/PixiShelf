import { captureArchiveFixtureSource } from '../../archive/__tests__/dedup-source-fixture.ts'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { createArchiveExecutorRegistrations } from '../../archive/executor.ts'
import { afterAll, beforeAll, expect } from 'vitest'
import {
  PrismaClient,
  freezeArtworkDedupRun,
  freezeArtworkDedupOperation,
  claimArtworkDedupOperationReader,
  recordArtworkDedupOperationReaderOwner,
  releaseArtworkDedupOperationReader,
  type Prisma
} from '@pixishelf/db'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type QueueDatabase,
  type QueueSqlExecutor,
  type ExecutionContext,
  type EnqueuedChildJob
} from '@pixishelf/job-runtime'
import type { ArtworkDedupScanPayload } from '@pixishelf/job-contracts'
import { executeArtworkDedup } from '../executor.ts'
import { DedupReaderSupervisor } from '../reader.ts'
import { prepareArtworkInventory, prepareArtworkDirectory, type DedupPrepareContext } from '../maintenance-prepare.ts'

export const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
export const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `prepare-executor-${randomUUID()}`
export const clock = new MutableQueueClock(new Date('2026-10-24T00:00:00Z'))
export const repository = db
  ? new PostgresQueueRepository(db as unknown as QueueDatabase, { clock, transactionTimeoutMs: 20000 })
  : null
const workerRequire = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
export const readerOptions = {
  entrypoint: new URL('../reader-child.ts', import.meta.url).pathname,
  execArgv: ['--import', workerRequire.resolve('tsx')]
}
const artists: number[] = [],
  artworks: number[] = [],
  runs: string[] = [],
  jobs: string[] = []
export let root: string
let userId: string
const archiveImports: string[] = []
export const fence = (job: ClaimedJob) => ({
  jobId: job.id,
  workerId: job.workerId,
  executionToken: job.executionToken,
  attempt: job.attempt
})
export function executionContext<T>(job: ClaimedJob): ExecutionContext<T, EnqueuedChildJob> {
  return {
    job,
    payload: job.payload as T,
    signal: new AbortController().signal,
    progress: (update) => repository!.updateProgress({ ...fence(job), ...update }),
    enqueueChild: async () => {
      throw new Error('Unexpected child')
    },
    mutateInTransaction: (operation) => repository!.withFencedMutationTransaction(fence(job), operation),
    finalizeInTransaction: async (operation) => {
      await repository!.withFencedExecutionTransaction(fence(job), operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  }
}
beforeAll(async () => {
  if (!db) return
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-prepare-')))
  userId = (await db.userBA.create({ data: { id: prefix, email: `${prefix}@test.invalid`, name: 'fixture' } })).id
})
afterAll(async () => {
  if (!db) return
  const identities = (
    await db.artworkDedupMedia.findMany({
      where: { runId: { in: runs } },
      distinct: ['rootIdentity'],
      select: { rootIdentity: true }
    })
  ).map((row) => row.rootIdentity)
  const operationIds=(await db.artworkDedupOperation.findMany({where:{runId:{in:runs}},select:{id:true}})).map(o=>o.id)
  await db.artworkDedupFileReceipt.deleteMany({where:{operationId:{in:operationIds}}})
  await db.artworkDedupClaim.deleteMany({where:{operationId:{in:operationIds}}})
  const sourceIds=(await db.artworkDedupOperationSource.findMany({where:{operationId:{in:operationIds}},select:{sourceId:true}})).map(s=>s.sourceId)
  await db.artworkDedupOperationSource.deleteMany({where:{operationId:{in:operationIds}}})
  await db.artworkDedupSourceIdentity.deleteMany({where:{id:{in:sourceIds},bindings:{none:{}}}})
  await db.artworkDedupOperation.deleteMany({ where: { runId: { in: runs } } })
  await db.artworkDedupRun.deleteMany({ where: { id: { in: runs } } })
  await db.image.deleteMany({ where: { artworkId: { in: artworks } } })
  await db.artwork.deleteMany({ where: { id: { in: artworks } } })
  const executions = await db.archiveImportExecution.findMany({
    where: { archiveImportId: { in: archiveImports } },
    select: { jobId: true }
  })
  jobs.push(...executions.map((row) => row.jobId))
  await db.archiveImport.deleteMany({ where: { id: { in: archiveImports } } })
  await db.artworkExternalRef.deleteMany({ where: { externalId: { in: archiveImports } } })
  await db.systemJob.deleteMany({ where: { id: { in: jobs } } })
  await db.artist.deleteMany({ where: { id: { in: artists } } })
  await db.userBA.delete({ where: { id: userId } })
  await db.mediaContentPathWrite.deleteMany({ where: { directory: { rootIdentity: { in: identities } } } })
  await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: { in: identities } } })
  await db.$disconnect()
  await fs.rm(root, { recursive: true, force: true })
})
export async function fixture(count = 1, kind: 'LOCAL_DIRECTORY' | 'PIXIV_SCAN' | 'URL_ARCHIVE' | 'MANUAL_CREATE' = 'LOCAL_DIRECTORY', options: {purpose?: 'ISOLATION'|'DIRECT_DELETE'; kinds?: ('LOCAL_DIRECTORY'|'PIXIV_SCAN'|'URL_ARCHIVE'|'MANUAL_CREATE')[]; archiveBytes?:boolean; groups?:number; beforeScan?: (ids: number[]) => Promise<void>} = {}) {
  const artist = await db!.artist.create({ data: { name: prefix } })
  artists.push(artist.id)
  const ids: number[] = []
  for (let n = 0; n < 2 * (options.groups ?? 1); n++) {
    const memberKind = options.kinds?.[n] ?? kind
    if (memberKind === 'URL_ARCHIVE') {
      const id = await publishedArchive(artist.id)
      ids.push(id)
      artworks.push(id)
      continue
    }
    const directory = `${randomUUID()}`
    await fs.mkdir(path.join(root, directory))
    const externalId = String(500000 + artworks.length)
    const metaSource = memberKind === 'PIXIV_SCAN' ? `${directory}/${externalId}-meta.json` : null
    const art = await db!.artwork.create({
      data: {
        title: prefix,
        createdVia: memberKind,
        source: memberKind === 'PIXIV_SCAN' ? 'PIXIV_IMPORTED' : memberKind === 'LOCAL_DIRECTORY' ? 'LOCAL_IMPORT' : 'LOCAL_CREATED',
        storagePath: directory,
        storageKey: directory,
        externalId,
        metaSource,
        creators: {
          create: {
            artistId: artist.id,
            evidence: { create: { provenance: 'MANUAL', evidenceKey: 'manual', present: true } }
          }
        }
      }
    })
    artworks.push(art.id)
    ids.push(art.id)
    if (metaSource)
      {await fs.writeFile(
        path.join(root, metaSource),
        JSON.stringify({ id: externalId, userId: '9', user: 'fixture', title: 'fixture' })
      )}
    for (let i = 0; i < count; i++) {
      const relative = `${directory}/${String(i).padStart(4, '0')}.bin`
      await fs.writeFile(path.join(root, relative), (options.archiveBytes ? png : Buffer.alloc(8, (i + Math.floor(n/2)*17) % 255)))
      await db!.image.create({ data: { artworkId: art.id, path: relative, size: options.archiveBytes ? BigInt(png.length) : 8n, sortOrder: i } })
    }
  }
  await options.beforeScan?.(ids)
  const scan = await db!.$transaction(async (tx) => {
    const { run } = await freezeArtworkDedupRun(tx, {
      artistId: artist.id,
      requestedBy: userId,
      idempotencyKey: randomUUID(),
      mode: 'FULL'
    })
    runs.push(run.id)
    const job = await tx.systemJob.create({
      data: {
        type: 'ARTWORK_DEDUP_SCAN',
        executionLane: 'BACKGROUND_WRITER',
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        queuePriority: 900,
        effectivePriority: 900,
        availableAt: clock.now(),
        payload: { runId: run.id, executionVersion: 1 }
      }
    })
    jobs.push(job.id)
    await tx.artworkDedupRun.update({ where: { id: run.id }, data: { jobId: job.id } })
    return job
  })
  const scanJob = await repository!.claim(prefix, [
    { jobType: 'ARTWORK_DEDUP_SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
  ])
  expect(scanJob?.id).toBe(scan.id)
  await executeArtworkDedup(executionContext<ArtworkDedupScanPayload>(scanJob!), {
    database: db!,
    sourceRoot: root,
    archiveRoot: root,
    readerOptions,
    now: () => clock.now().getTime()
  })
  const run = await db!.artworkDedupRun.findUniqueOrThrow({ where: { jobId: scan.id } })
  expect(run).toMatchObject({ status: 'COMPLETED', groupCount: options.groups ?? 1 })
  const op = await db!.$transaction(async (tx) => {
    const { operation } = await freezeArtworkDedupOperation(tx, {
      userId,
      preparePurpose: options.purpose ?? 'ISOLATION',
      runId: run.id,
      expectedRunVersion: run.version,
      expectedReviewRevision: 0,
      idempotencyKey: randomUUID(),
      selection: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] }
    })
    const job = await tx.systemJob.create({
      data: {
        type: 'ARTWORK_DEDUP_MAINTENANCE',
        executionLane: 'BACKGROUND_WRITER',
        status: 'PENDING',
        triggerSource: 'SYSTEM',
        queuePriority: 900,
        effectivePriority: 900,
        availableAt: clock.now(),
        payload: { operationId: operation.id, executionVersion: 1, mode: 'PREPARE' }
      }
    })
    jobs.push(job.id)
    await tx.artworkDedupOperation.update({ where: { id: operation.id }, data: { jobId: job.id } })
    return { id: operation.id, jobId: job.id }
  })
  const job = await repository!.claim(prefix, [
    { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
  ])
  expect(job?.id).toBe(op.jobId)
  const execution = { operationId: op.id, jobId: op.jobId, executionVersion: 1 }
  const transaction: DedupPrepareContext['transaction'] = <T>(action: (tx: Prisma.TransactionClient) => Promise<T>) =>
    repository!.withFencedMutationTransaction<Prisma.TransactionClient & QueueSqlExecutor, T>(fence(job!), (tx) =>
      action(tx)
    )
  const readerToken = randomUUID()
  await transaction((tx) => claimArtworkDedupOperationReader(tx, { execution, readerToken }))
  const reader = new DedupReaderSupervisor(readerOptions).create()
  const owner = await reader.start()
  await transaction((tx) => recordArtworkDedupOperationReaderOwner(tx, { execution, readerToken, owner }))
  const signal = new AbortController().signal
  const roots = await reader.resolveRoots(
    { operation: 'roots', sourceRoot: root, archiveRoot: root, expectedPixivRootIdentity: null },
    signal
  )
  const context: DedupPrepareContext = { execution, transaction, reader, roots, signal, shouldYield: () => false }
  return {
    context,
    ids,
    job: job!,
    item: (artworkId: number) =>
      db!.artworkDedupOperationArtwork.findUniqueOrThrow({
        where: { operationId_artworkId: { operationId: op.id, artworkId } }
      }),
    async detachReader() {
      await reader.close()
      await db!.$transaction((tx) => releaseArtworkDedupOperationReader(tx, { execution, readerToken }))
    },
    async close() {
      await reader.close()
      const op = await db!.artworkDedupOperation.findUniqueOrThrow({ where: { id: execution.operationId } })
      if (op.readerToken === readerToken)
        {await db!.$transaction((tx) => releaseArtworkDedupOperationReader(tx, { execution, readerToken }))}
      if ((await db!.systemJob.findUniqueOrThrow({ where: { id: job!.id } })).status !== 'RUNNING') return
      await db!.systemJob.update({ where: { id: job!.id }, data: { leaseToken: job!.leaseToken } })
      await repository!.fail({ ...fence(job!), errorCode: 'INTERNAL_ERROR', error: 'Fixture finished' })
    }
  }
}
export async function finishInventory(f: Awaited<ReturnType<typeof fixture>>, id: number) {
  for (let n = 0; n < 100; n++) if (await prepareArtworkInventory(f.context, await f.item(id))) return
  throw new Error('Unbounded inventory')
}
export async function finishDirectory(f: Awaited<ReturnType<typeof fixture>>, id: number) {
  for (let n = 0; n < 100; n++) if (await prepareArtworkDirectory(f.context, await f.item(id))) return
  throw new Error('Unbounded directory')
}

const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#336699' } })
  .png()
  .toBuffer()
async function publishedArchive(artistId: number) {
  const id = `${prefix}-${randomUUID()}`
  archiveImports.push(id)
  const job = await db!.systemJob.create({
    data: {
      type: 'ARCHIVE_DOWNLOAD',
      executionLane: 'ARCHIVE_DOWNLOAD',
      triggerSource: 'SYSTEM',
      queuePriority: 900,
      effectivePriority: 900,
      availableAt: clock.now(),
      payload: { archiveImportId: id, defaultTagIds: [] }
    }
  })
  jobs.push(job.id)
  await db!.archiveImport.create({
    data: {
      id,
      systemJobId: job.id,
      phase: 'DOWNLOAD',
      origin: 'AUTO',
      providerKey: 'test',
      externalId: id,
      dedupSourceSnapshot: await captureArchiveFixtureSource(db!, 'test', id),
      submittedUrl: 'https://example.test/archive',
      canonicalUrl: `https://example.test/${id}`,
      locator: {},
      normalizedMetadata: { titles: { display: prefix } },
      rawMetadata: {},
      metadataHash: 'a'.repeat(64),
      creatorBucket: 'bucket',
      stagingPath: `.archive-staging/${id}`,
      totalItems: 1,
      executions: { create: { jobId: job.id, phase: 'DOWNLOAD' } },
      items: {
        create: {
          pageIndex: 7,
          sourcePageUrl: 'https://example.test/image',
          locator: {},
          expectedFilename: 'image.png'
        }
      }
    }
  })
  const definitions = createArchiveExecutorRegistrations({
    database: db!,
    config: { scanRoot: root, sourceMediaRoot: root, mediaConcurrency: 1 },
    now: () => clock.now(),
    providers: {
      get: () => ({
        key: 'test',
        openMedia: async () => ({
          stream: Readable.from([png]),
          contentLength: png.length,
          mimeType: 'image/png',
          originalFilename: 'image.png',
          quality: 'ORIGINAL' as const,
          remoteHost: 'example.test'
        })
      })
    }
  })
  for (const type of ['ARCHIVE_DOWNLOAD', 'ARCHIVE_PUBLISH'] as const) {
    const claimed = await repository!.claim(prefix, [
      {
        jobType: type,
        executionLane: type === 'ARCHIVE_DOWNLOAD' ? 'ARCHIVE_DOWNLOAD' : 'BACKGROUND_WRITER',
        definitionVersions: [1]
      }
    ])
    expect(claimed).not.toBeNull()
    const definition = definitions.find((row) => row.jobType === type)!
    await definition.execute({
      ...executionContext<unknown>(claimed!),
      payload: definition.parsePayload!(claimed!.payload)
    })
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: claimed!.id } })).status).toBe('COMPLETED')
  }
  const published = await db!.archiveImport.findUniqueOrThrow({ where: { id }, include: { generations: true } })
  expect(published.status).toBe('COMPLETED')
  expect(published.generations[0]?.sealedAt).not.toBeNull()
  expect(published.generations[0]?.drainedAt).not.toBeNull()
  const artworkId = published.publishedArtworkId!
  await db!.artwork.update({
    where: { id: artworkId },
    data: {
      creators: {
        create: { artistId, evidence: { create: { provenance: 'MANUAL', evidenceKey: 'manual', present: true } } }
      }
    }
  })
  return artworkId
}

export function trackMaintenanceJob(id:string) { jobs.push(id) }
export function trackDedupRun(id:string) { runs.push(id) }
