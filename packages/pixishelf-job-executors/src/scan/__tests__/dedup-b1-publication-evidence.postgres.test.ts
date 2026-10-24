import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PrismaClient, captureArtworkDedupSources, type Prisma } from '@pixishelf/db'
import {
  serializeArtworkDedupSourceSnapshot,
  type JobType,
  type MigrationPayload,
  type ScanPayload
} from '@pixishelf/job-contracts'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ExecutionContext,
  type EnqueuedChildJob,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { executeLocalArtworkRescan } from '../local-rescan.ts'
import { resolveSafeScanRoot } from '../paths.ts'
import { computeLocalWorkContentFingerprint } from '../fingerprint.ts'
import { localWorkInputDigest } from '../digests.ts'
import { DEFAULT_SCAN_LIMITS } from '../types.ts'
import { resolveMediaContentRoots } from '../../media-content/roots.ts'
import { createPixivArtworkExecutorRegistrations } from '../../pixiv-artwork/executors.ts'
import { createPixivSeriesExecutorRegistrations } from '../../pixiv-series/executors.ts'
import { executeMigration } from '../../migration/executor.ts'
import { createPrismaMigrationDatabase } from '../../migration/prisma-database.ts'
import { createNodeMigrationFileSystem } from '../../migration/file-system.ts'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/dedup_executor_next') {
    throw new Error('Use the authorized synthetic executor database')
  }
}
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `dedup-b1-publication-${randomUUID()}`,
  roots: string[] = [],
  sourceIds: string[] = [],
  jobIds: string[] = [],
  seriesIds: number[] = []
async function root() {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-b1-publication-'))
  roots.push(value)
  return value
}
function probe(input: { artworkIds: number[]; root?: boolean; seriesId?: number; refId?: string }) {
  let hits = 0
  return {
    hits: () => hits,
    wrap<T extends object>(transaction: T): T {
      let observed = false
      return new Proxy(transaction, {
        get(target, key, receiver) {
          const value = Reflect.get(target, key, receiver)
          if (key !== '$queryRawUnsafe') return value
          return async (...args: unknown[]) => {
            if (!observed && String(args[0]).includes('pg_advisory_xact_lock(7341902118)')) {
              observed = true
              await db!.$transaction(async (other) => {
                await other.$executeRawUnsafe("SET LOCAL lock_timeout='250ms'")
                await other.$queryRawUnsafe('SELECT pg_advisory_xact_lock(7341902118)::text')
                if (input.root) {
                  expect(
                    await other.$queryRawUnsafe(
                      'SELECT id FROM "MediaContentDirectoryState" WHERE "logicalRoot"=\'source-media:v1\' AND "relativeDirectory"=\'\' FOR UPDATE'
                    )
                  ).toHaveLength(1)
                }
                for (const id of [...input.artworkIds].sort((a, b) => a - b)) {
                  expect(await other.$queryRaw`SELECT id FROM "Artwork" WHERE id=${id} FOR UPDATE`).toHaveLength(1)
                }
                if (input.seriesId) {
                  expect(
                    await other.$queryRaw`SELECT id FROM "Series" WHERE id=${input.seriesId} FOR UPDATE`
                  ).toHaveLength(1)
                }
                if (input.refId) {
                  expect(
                    await other.$queryRaw`SELECT id FROM artwork_external_refs WHERE id=${input.refId} FOR UPDATE`
                  ).toHaveLength(1)
                }
              })
              hits++
            }
            return Reflect.apply(value as (...values: unknown[]) => unknown, target, args)
          }
        }
      })
    }
  }
}
async function execution<T>(type: JobType, payload: T, publicationProbe?: ReturnType<typeof probe>) {
  const now = new Date(),
    id = `${prefix}-${randomUUID()}`
  jobIds.push(id)
  await db!.systemJob.create({
    data: {
      id,
      type,
      triggerSource: 'MANUAL',
      payload: payload as Prisma.InputJsonValue,
      availableAt: now,
      queuePriority: 0,
      effectivePriority: 0
    }
  })
  expect(
    await db!.systemJob.count({ where: { type, status: { in: ['PENDING', 'RETRY_WAIT'] }, id: { notIn: jobIds } } })
  ).toBe(0)
  const repository = new PostgresQueueRepository(db! as unknown as QueueDatabase, {
    clock: new MutableQueueClock(now),
    transactionTimeoutMs: 20000
  })
  const job = (await repository.claim(prefix, [
    { jobType: type, executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
  ]))!
  expect(job.id).toBe(id)
  const fence = { jobId: id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
  const context: ExecutionContext<T, EnqueuedChildJob> = {
    job,
    payload,
    signal: new AbortController().signal,
    progress: (update) => repository.updateProgress({ ...fence, ...update }),
    enqueueChild: async () => {
      throw new Error('unexpected child')
    },
    mutateInTransaction: (work) =>
      repository.withFencedMutationTransaction(fence, (tx) =>
        work((publicationProbe ? publicationProbe.wrap(tx) : tx) as never)
      ),
    finalizeInTransaction: async (work) => {
      await repository.withFencedExecutionTransaction(fence, (scope) =>
        work({
          ...scope,
          transaction: (publicationProbe ? publicationProbe.wrap(scope.transaction) : scope.transaction) as never
        })
      )
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
  return { context, id, repository, fence }
}
async function cleanup() {
  if (!db) return
  await db.mediaContentSource.updateMany({
    where: { image: { artwork: { title: { startsWith: prefix } } } },
    data: { writeToken: null, writeStartedAt: null, directoryStateId: null }
  })
  await db.artworkContentSource.updateMany({
    where: { artwork: { title: { startsWith: prefix } } },
    data: { writeToken: null, writeStartedAt: null }
  })
  await db.mediaContentPathWrite.deleteMany({ where: { jobId: { in: jobIds } } })
  await db.jobResourceLease.deleteMany({ where: { ownerJobId: { in: jobIds } } })
  await db.systemJob.deleteMany({ where: { id: { in: jobIds } } })
  await db.series.deleteMany({ where: { id: { in: seriesIds } } })
  await db.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
  await db.artist.deleteMany({ where: { name: prefix } })
  await db.artworkDedupSourceIdentity.deleteMany({ where: { id: { in: sourceIds } } })
  for (const value of roots) {
    const bindings = await resolveMediaContentRoots({
      sourceRoot: value,
      archiveRoot: value,
      expectedPixivRootIdentity: null
    })
    await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: bindings.source.rootIdentity } })
    await fs.rm(value, { recursive: true, force: true })
  }
  roots.length = 0
}
describe.skipIf(!db)('B1 actual final publication catalog barriers', () => {
  afterEach(cleanup)
  afterAll(async () => {
    await cleanup()
    await db?.$disconnect()
  })
  it('Local artwork rescan final transaction lets a competing catalog owner lock the same root and Artwork first', async () => {
    const scanRoot = await root(),
      relativePath = `${prefix}/local`
    await fs.mkdir(path.join(scanRoot, relativePath), { recursive: true })
    await fs.writeFile(path.join(scanRoot, relativePath, '1.jpg'), 'media')
    const artwork = await db!.artwork.create({
      data: { title: prefix, source: 'LOCAL_IMPORT', createdVia: 'LOCAL_DIRECTORY', storagePath: relativePath }
    })
    const payload: ScanPayload = { mode: 'ARTWORK_RESCAN', artworkId: artwork.id }
    const barrier = probe({ artworkIds: [artwork.id], root: true }),
      run = await execution('SCAN', payload, barrier)
    const bindings = await resolveMediaContentRoots({
      sourceRoot: scanRoot,
      archiveRoot: scanRoot,
      expectedPixivRootIdentity: null
    })
    const sources = await db!.$transaction((tx) =>
      captureArtworkDedupSources(tx, {
        identities: [
          {
            kind: 'DIRECTORY',
            logicalRoot: bindings.source.logicalRoot,
            rootIdentity: bindings.source.rootIdentity,
            canonicalPath: relativePath
          }
        ]
      })
    )
    sourceIds.push(...sources.map((source) => source.sourceId))
    const fingerprint = await computeLocalWorkContentFingerprint({
      scanRoot,
      relativeDirectory: relativePath,
      kind: 'MEDIA_DIRECTORY',
      maxEntries: 10,
      maxFiles: 10,
      maxFileBytes: 1024,
      signal: new AbortController().signal
    })
    const work = { ordinal: 0, kind: 'MEDIA_DIRECTORY' as const, relativePath, fingerprint }
    const scanRun = await db!.scanRun.create({
      data: {
        systemJobId: run.id,
        type: 'LOCAL_IMPORT',
        mode: 'LOCAL_RESCAN',
        status: 'RUNNING',
        inputCount: 1,
        inputDigest: localWorkInputDigest([work]),
        inputFrozenAt: new Date(),
        localWorkInputs: { create: { ...work, dedupSourceSnapshot: serializeArtworkDedupSourceSnapshot(sources) } }
      }
    })
    expect(
      await executeLocalArtworkRescan({
        context: run.context,
        dependencies: { database: db! as never, config: { scanRoot } },
        root: await resolveSafeScanRoot(scanRoot),
        run: scanRun,
        limits: DEFAULT_SCAN_LIMITS,
        now: new Date()
      })
    ).toMatchObject({ status: 'SUCCESS', newImages: 1 })
    expect(barrier.hits()).toBe(1)
    expect(await db!.image.findFirst({ where: { artworkId: artwork.id } })).toMatchObject({
      path: `${relativePath}/1.jpg`
    })
    expect(await db!.scanRunItem.findFirst({ where: { scanRunId: scanRun.id } })).toMatchObject({
      status: 'SUCCESS',
      action: 'UPDATE'
    })
    await run.repository.withFencedExecutionTransaction(run.fence, (scope) =>
      scope.complete({ result: { evidence: 'Local rescan final transaction' } })
    )
  })
  it.each(['source-sync', 'series'] as const)(
    '%s runs the actual executor finalizer and shared Series publication behind the catalog barrier',
    async (mode) => {
      const pixivDataRoot = await root(),
        remoteId = String(800000000000 + Math.floor(Math.random() * 100000000)),
        seriesId = `${remoteId}9`
      const first = await db!.artwork.create({ data: { title: `${prefix}-old` } }),
        second = await db!.artwork.create({ data: { title: `${prefix}-other` } })
      const ref = await db!.artworkExternalRef.create({
        data: {
          artworkId: first.id,
          providerKey: 'pixiv',
          externalId: remoteId,
          canonicalUrl: `https://www.pixiv.net/artworks/${remoteId}`,
          locator: {}
        }
      })
      const series = await db!.series.create({
        data: {
          title: `${prefix}-series-old`,
          externalRefs: { create: { providerKey: 'pixiv', externalId: seriesId } },
          seriesArtworks: {
            create: [
              { artworkId: first.id, sortOrder: 1, provenance: 'MANUAL' },
              { artworkId: second.id, sortOrder: 2, provenance: 'MANUAL' }
            ]
          }
        }
      })
      seriesIds.push(series.id)
      const barrier = probe({ artworkIds: [first.id, second.id], seriesId: series.id, refId: ref.id })
      const payload = {
        mode: 'ARTWORK' as const,
        artworkId: first.id,
        expectedExternalRefId: ref.id,
        expectedPixivArtworkId: remoteId,
        adoptSourceText: true,
        refreshExisting: false
      }
      const run = await execution(
        mode === 'source-sync' ? 'PIXIV_ARTWORK_ENRICHMENT' : 'PIXIV_SERIES_RECONCILIATION',
        payload,
        barrier
      )
      const fetchImpl = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: false,
              body: {
                id: remoteId,
                title: `${prefix}-changed`,
                description: 'synthetic',
                userId: '2001',
                userName: 'Fixture',
                pageCount: 1,
                width: 1,
                height: 1,
                bookmarkCount: 17,
                aiType: 0,
                illustType: 0,
                tags: { tags: [] },
                seriesNavData: { seriesId, title: `${prefix}-series-changed`, order: 1 }
              }
            }),
            { status: 200 }
          )
      )
      const dependencies = {
        database: db!,
        pixivDataRoot,
        fetchImpl: fetchImpl as typeof fetch,
        sleep: async () => undefined
      }
      const [registration] =
        mode === 'source-sync'
          ? createPixivArtworkExecutorRegistrations(dependencies)
          : createPixivSeriesExecutorRegistrations(dependencies)
      await registration!.execute(run.context as never)
      expect(fetchImpl).toHaveBeenCalledOnce()
      expect(barrier.hits()).toBe(1)
      expect(await db!.systemJob.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: 'COMPLETED' })
      expect(await db!.series.findUniqueOrThrow({ where: { id: series.id } })).toMatchObject({
        title: `${prefix}-series-changed`
      })
      if (mode === 'source-sync') {
        expect(await db!.artwork.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
          title: `${prefix}-changed`,
          bookmarkCount: 17
        })
      } else {
        expect(await db!.artworkExternalRef.findUniqueOrThrow({ where: { id: ref.id } })).toMatchObject({
          seriesSyncStatus: 'PARTIAL'
        })
        expect(await db!.systemJob.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
          result: { status: 'PARTIAL', protectedFields: ['membership'], titleUpdated: true }
        })
        expect(
          await db!.seriesArtwork.findUniqueOrThrow({
            where: { seriesId_artworkId: { seriesId: series.id, artworkId: first.id } }
          })
        ).toMatchObject({ provenance: 'MANUAL', sourceRefId: null })
      }
    }
  )
  it('migration executes real file transfer and final database publication before releasing the original directory owner', async () => {
    const scanRoot = await root(),
      artistId = `${prefix}-artist`,
      externalId = `${prefix}-work`,
      targetDirectory = `${artistId}/${externalId}`,
      source = `${prefix}/source/page.jpg`,
      target = `${targetDirectory}/page.jpg`
    const artist = await db!.artist.create({
      data: { name: prefix, externalRefs: { create: { providerKey: 'pixiv', externalId: artistId } } }
    })
    const artwork = await db!.artwork.create({
      data: {
        title: prefix,
        artistId: artist.id,
        createdVia: 'PIXIV_SCAN',
        externalRefs: {
          create: { providerKey: 'pixiv', externalId, canonicalUrl: 'https://example.test/', locator: {} }
        }
      }
    })
    const image = await db!.image.create({ data: { artworkId: artwork.id, path: `/${source}`, size: 7n } })
    await fs.mkdir(path.dirname(path.join(scanRoot, source)), { recursive: true })
    await fs.writeFile(path.join(scanRoot, source), 'content')
    const payload: MigrationPayload = {
      selection: { mode: 'ARTWORK_IDS', artworkIds: [artwork.id] },
      safety: { transferMode: 'move', verifyAfterCopy: true, cleanupSource: true }
    }
    const run = await execution('MIGRATION', payload)
    const item = await db!.migrationJobItem.create({
      data: {
        systemJobId: run.id,
        artworkIdSnapshot: artwork.id,
        sourceDirectory: path.posix.dirname(source),
        targetDirectory,
        files: {
          create: {
            ordinal: 0,
            imageId: image.id,
            sourceRelativePath: `/${source}`,
            targetRelativePath: `/${target}`,
            stagedRelativePath: '.migration-staging/review/page.jpg'
          }
        }
      }
    })
    const port = createPrismaMigrationDatabase(db!),
      publish = port.publishArtwork,
      barrier = probe({ artworkIds: [artwork.id], root: true })
    port.publishArtwork = (transaction, input) => publish(barrier.wrap(transaction), input)
    await executeMigration(run.context, {
      database: port,
      fileSystem: createNodeMigrationFileSystem(),
      config: { scanRoot }
    })
    expect(barrier.hits()).toBe(1)
    expect(await db!.systemJob.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: 'COMPLETED' })
    expect(await db!.migrationJobItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({
      status: 'COMPLETED'
    })
    expect(await db!.image.findUniqueOrThrow({ where: { id: image.id } })).toMatchObject({ path: `/${target}` })
    expect(await fs.readFile(path.join(scanRoot, target), 'utf8')).toBe('content')
    await expect(fs.stat(path.join(scanRoot, source))).rejects.toMatchObject({ code: 'ENOENT' })
    const writes = await db!.mediaContentPathWrite.findMany({ where: { jobId: run.id } })
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((write) => write.status === 'COMPLETED')).toBe(true)
  })
})
