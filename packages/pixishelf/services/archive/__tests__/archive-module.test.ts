import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveModule } from '../archive-module'
import { ArchiveProviderRegistry } from '../provider-registry'
import type { ArchiveProvider, ResolvedArchive } from '../types'

const { prismaMock } = vi.hoisted(() => {
  const prismaMock = {
    artworkExternalRef: { findUnique: vi.fn() },
    archiveImport: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    archiveImportItem: { updateMany: vi.fn() },
    archivePreviewSession: { deleteMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    systemJob: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn()
  }
  return { prismaMock }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const resolved: ResolvedArchive = {
  providerKey: 'test-provider',
  externalId: '42',
  canonicalUrl: 'https://archive.test/g/42/token/',
  locator: { id: '42', token: 'redacted' },
  title: 'Archived work',
  titleAliases: ['Alias'],
  description: null,
  category: 'Manga',
  uploader: 'uploader',
  thumbnailUrl: null,
  postedAt: new Date('2026-01-01T00:00:00.000Z'),
  tags: [{ namespace: 'artist', name: 'creator' }],
  relationships: [],
  media: [
    {
      index: 0,
      sourcePageUrl: 'https://archive.test/s/page/42-1',
      locator: { page: 1 },
      expectedFilename: '0001'
    }
  ],
  normalizedMetadata: { titles: { display: 'Archived work' }, tags: [], relationships: [] },
  rawMetadata: { id: 42 },
  warnings: [],
  creatorBucket: 'artist--creator'
}

const provider: ArchiveProvider = {
  key: 'test-provider',
  accepts: (url) => url.hostname === 'archive.test',
  resolve: vi.fn().mockResolvedValue(resolved),
  openMedia: vi.fn()
}

describe('archive module', () => {
  const module = new ArchiveModule(new ArchiveProviderRegistry([provider]))

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ARCHIVE_STORAGE_PATH = 'D:/archive-root'
    prismaMock.$transaction.mockImplementation(async (value: unknown) => {
      if (typeof value === 'function') return value(prismaMock)
      return Promise.all(value as Promise<unknown>[])
    })
    prismaMock.archivePreviewSession.deleteMany.mockResolvedValue({ count: 0 })
  })

  afterEach(() => {
    delete process.env.ARCHIVE_STORAGE_PATH
  })

  it('creates a metadata-only preview without creating a task or artwork', async () => {
    prismaMock.artworkExternalRef.findUnique.mockResolvedValue(null)
    prismaMock.archiveImport.findFirst.mockResolvedValue(null)
    prismaMock.archivePreviewSession.create.mockResolvedValue({ id: 'preview-1' })

    const preview = await module.preview('https://archive.test/g/42/token/')

    expect(preview).toMatchObject({ previewToken: 'preview-1', externalId: '42', pageCount: 1, isUpdate: false })
    expect(prismaMock.archivePreviewSession.create).toHaveBeenCalledOnce()
    expect(prismaMock.systemJob.create).not.toHaveBeenCalled()
    expect(prismaMock.archiveImport.create).not.toHaveBeenCalled()
  })

  it('enqueues durable item checkpoints from a confirmed preview', async () => {
    prismaMock.archivePreviewSession.findUnique.mockResolvedValue({
      id: 'preview-1',
      providerKey: resolved.providerKey,
      externalId: resolved.externalId,
      resolved: JSON.parse(JSON.stringify({ ...resolved, submittedUrl: 'https://archive.test/submitted' })),
      metadataHash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 60_000)
    })
    prismaMock.archiveImport.findFirst.mockResolvedValue(null)
    prismaMock.systemJob.create.mockResolvedValue({ id: 'job-1' })
    prismaMock.archiveImport.create.mockResolvedValue({ id: 'import-1' })
    prismaMock.archivePreviewSession.delete.mockResolvedValue({ id: 'preview-1' })

    const result = await module.enqueue({ previewToken: 'preview-1', quality: 'ORIGINAL' })

    expect(result.reused).toBe(false)
    expect(prismaMock.archiveImport.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerKey: 'test-provider',
        externalId: '42',
        totalItems: 1,
        selectedQuality: 'ORIGINAL',
        items: {
          create: [
            expect.objectContaining({ pageIndex: 0, sourcePageUrl: 'https://archive.test/s/page/42-1' })
          ]
        }
      })
    })
    expect(prismaMock.archivePreviewSession.delete).toHaveBeenCalledWith({ where: { id: 'preview-1' } })
  })

  it('resets failed-item attempts when an administrator retries a terminal task', async () => {
    prismaMock.archiveImport.findUnique.mockResolvedValue({
      id: 'import-1',
      systemJobId: 'job-1',
      status: 'FAILED',
      publishedArtworkId: null
    })
    prismaMock.archiveImportItem.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.archiveImport.update.mockResolvedValue({ id: 'import-1' })
    prismaMock.systemJob.update.mockResolvedValue({ id: 'job-1' })
    prismaMock.archiveImport.findUnique.mockResolvedValueOnce({
      id: 'import-1',
      systemJobId: 'job-1',
      status: 'FAILED',
      publishedArtworkId: null
    }).mockResolvedValueOnce(null)

    await module.requestAction('import-1', 'RETRY')

    expect(prismaMock.archiveImportItem.updateMany).toHaveBeenCalledWith({
      where: { archiveImportId: 'import-1', status: 'FAILED' },
      data: expect.objectContaining({ status: 'PENDING', attempts: 0 })
    })
  })
})
