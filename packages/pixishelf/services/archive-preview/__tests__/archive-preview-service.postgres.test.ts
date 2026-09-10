import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import {
  DefaultArchiveMediaProviderRegistry,
  GovernedArchiveProviderRegistry,
  PostgresArchiveProviderGovernor
} from '@pixishelf/job-executors'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ArchivePreviewStore, listArchivePreviewSources, openArchivePreview } from '../archive-preview-service'

const testDatabaseUrl = Reflect.get(process.env, 'PIXISHELF_TEST_DATABASE_URL') as string | undefined
const describePostgres = testDatabaseUrl ? describe.sequential : describe.skip
const database = createDatabaseClient(testDatabaseUrl ? { datasourceUrl: testDatabaseUrl } : undefined)
const prefix = `archive-preview-${randomUUID()}`
const requestedByUserId = `${prefix}-user`
const gid = Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 10), 16).toString()
const canonicalUrl = `https://e-hentai.org/g/${gid}/previewtoken/`

describePostgres('archive preview PostgreSQL boundaries', () => {
  beforeAll(async () => database.$connect())

  afterEach(async () => {
    await database.archiveUploaderSource.deleteMany({ where: { normalizedIdentity: { startsWith: prefix } } })
    await database.archiveIntakeSubmission.deleteMany({ where: { requestedByUserId } })
    const jobs = await database.systemJob.findMany({ where: { requestedByUserId }, select: { id: true } })
    if (jobs.length > 0) {
      await database.archiveImport.deleteMany({ where: { systemJobId: { in: jobs.map(({ id }) => id) } } })
      await database.systemJob.deleteMany({ where: { id: { in: jobs.map(({ id }) => id) } } })
    }
    await database.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
    await database.archiveProviderRequestLease.deleteMany({ where: { providerKey: 'e-hentai' } })
  })

  afterAll(async () => disconnectDatabase(database))

  it('resolves active stored identities read-only while every remote read uses the shared PostgreSQL governor', async () => {
    const artwork = await database.artwork.create({
      data: {
        title: `${prefix}-active-artwork`,
        externalRefs: {
          create: { providerKey: 'e-hentai', externalId: gid, canonicalUrl, locator: { gid, token: 'private' } }
        }
      },
      select: { id: true, externalRefs: { select: { id: true } } }
    })
    const externalRefId = artwork.externalRefs[0]!.id
    const before = await Promise.all([
      database.systemJob.count({ where: { requestedByUserId } }),
      database.archiveIntakeItem.count({ where: { submission: { requestedByUserId } } })
    ])
    const previewPage = vi.fn(async (input: { page: number }, context?: { runResolveRequest?<T>(fn: () => Promise<T>): Promise<T> }) => {
      const result = {
        providerKey: 'e-hentai',
        externalId: gid,
        canonicalUrl,
        title: `${prefix}-remote-title`,
        total: 1,
        page: input.page,
        items: [{ ordinal: 0, url: `https://ehgt.org/thumb/${gid}.jpg`, width: 120, height: 160 }],
        nextPage: null
      }
      return context?.runResolveRequest ? context.runResolveRequest(async () => result) : result
    })
    const provider = {
      key: 'e-hentai',
      requestGovernance: 'PER_REQUEST' as const,
      accepts: (url: URL) => url.hostname === 'e-hentai.org',
      resolve: vi.fn(),
      openMedia: vi.fn(),
      previewPage
    }
    const providers = new GovernedArchiveProviderRegistry(
      new DefaultArchiveMediaProviderRegistry([provider as never]),
      new PostgresArchiveProviderGovernor(database, { minimumIntervalMs: 1, leaseDurationMs: 5_000 })
    )
    const dependencies = {
      database,
      providers,
      store: new ArchivePreviewStore(),
      createId: () => 'preview-postgres-123456'
    }

    await expect(listArchivePreviewSources({ artworkId: artwork.id }, dependencies)).resolves.toEqual([
      { externalRefId, providerKey: 'e-hentai', label: `#${gid}` }
    ])
    await expect(
      openArchivePreview({ source: { kind: 'artwork', externalRefId } }, requestedByUserId, dependencies)
    ).resolves.toMatchObject({ previewId: 'preview-postgres-123456', total: 1, page: 0 })

    expect(previewPage).toHaveBeenCalledTimes(1)
    await expect(database.archiveProviderThrottle.findUnique({ where: { providerKey: 'e-hentai' } })).resolves.not.toBeNull()
    await expect(database.archiveProviderRequestLease.count({ where: { providerKey: 'e-hentai' } })).resolves.toBe(0)
    await expect(
      Promise.all([
        database.systemJob.count({ where: { requestedByUserId } }),
        database.archiveIntakeItem.count({ where: { submission: { requestedByUserId } } })
      ])
    ).resolves.toEqual(before)

    await database.artwork.update({
      where: { id: artwork.id },
      data: { archiveLifecycleState: 'TRASHED', deletedAt: new Date() }
    })
    await expect(listArchivePreviewSources({ artworkId: artwork.id }, dependencies)).resolves.toEqual([])
    previewPage.mockClear()
    await expect(
      openArchivePreview({ source: { kind: 'artwork', externalRefId } }, requestedByUserId, dependencies)
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(previewPage).not.toHaveBeenCalled()
  })
})
