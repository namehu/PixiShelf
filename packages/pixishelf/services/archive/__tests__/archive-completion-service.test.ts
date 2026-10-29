import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completeArchiveArtwork, completeArchiveArtworkSchema } from '../archive-completion-service'

const { submit } = vi.hoisted(() => ({ submit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/services/archive-intake/archive-intake-service', () => ({
  createArchiveIntakeSubmissionInTransaction: submit
}))

function fixture() {
  const media = {
    imageId: 4,
    index: 0,
    path: 'media/0.png',
    size: '10',
    width: 2,
    height: 3,
    sha256: 'b'.repeat(64),
    mimeType: 'image/png'
  }
  const base = {
    id: 'base',
    artworkId: 7,
    sourceTotalItems: 30,
    sourcePlanDigest: 'a'.repeat(64),
    archivePath: 'sources/gallery/base',
    metadataHash: 'c'.repeat(64),
    mediaSnapshot: [media],
    externalRef: { canonicalUrl: 'https://e-hentai.org/g/123/token/', providerKey: 'e-hentai', externalId: '123' },
    archiveImport: { selectedQuality: 'DISPLAY' }
  }
  const image = {
    id: 4,
    sortOrder: 0,
    path: `${base.archivePath}/${media.path}`,
    size: 10n,
    contentSource: { revision: 2n, writeToken: null },
    chaptersPath: null
  }
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7, mediaRevision: 3 }]),
    $queryRawUnsafe: vi.fn(),
    archiveRevision: {
      findUnique: vi.fn().mockResolvedValue(base),
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ ...base, isCurrent: true, retiredAt: null, downloadScope: 'FIRST_20' })
    },
    archiveIntakeItem: {
      findFirst: vi.fn().mockResolvedValue({ id: 'intake', status: 'QUEUED', completionBaseRevisionId: null }),
      update: vi.fn()
    },
    archiveImport: { count: vi.fn().mockResolvedValue(0) },
    artwork: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({
          id: 7,
          mediaRevision: 3,
          deletedAt: null,
          archiveLifecycleState: 'ACTIVE',
          storagePath: base.archivePath,
          images: [image]
        })
    }
  }
  const database = { $transaction: vi.fn((fn) => fn(tx)) }
  return { tx, base, image, database: database as never }
}
const input = { artworkId: 7, expectedRevisionId: 'base', idempotencyKey: 'request' }
beforeEach(() => {
  submit.mockReset().mockResolvedValue({ id: 'submission' })
})

describe('explicit partial archive completion', () => {
  it('takes source and quality from the current revision and freezes reusable media evidence', async () => {
    const f = fixture()
    await expect(completeArchiveArtwork(input, 'admin', f.database)).resolves.toEqual({
      intakeItemId: 'intake',
      archiveImportId: null
    })
    expect(submit).toHaveBeenCalledWith(
      {
        idempotencyKey: 'archive-complete:request',
        urls: [f.base.externalRef.canonicalUrl],
        downloadMode: 'MANUAL',
        quality: 'DISPLAY',
        downloadScope: 'ALL'
      },
      'admin',
      f.tx
    )
    expect(f.tx.archiveIntakeItem.update).toHaveBeenCalledWith({
      where: { id: 'intake' },
      data: {
        completionBaseRevisionId: 'base',
        completionSnapshot: expect.objectContaining({
          sourceTotalItems: 30,
          sourcePlanDigest: 'a'.repeat(64),
          quality: 'DISPLAY',
          mediaRevision: 3,
          media: [expect.objectContaining({ imageId: 4, imagePath: f.image.path, contentRevision: '2' })]
        })
      }
    })
  })
  it('replays an accepted request even when publication has advanced', async () => {
    const f = fixture()
    f.tx.archiveIntakeItem.findFirst.mockResolvedValue({
      id: 'intake',
      completionBaseRevisionId: 'base',
      archiveImportId: 'completed'
    } as never)
    await expect(completeArchiveArtwork(input, 'admin', f.database)).resolves.toEqual({
      intakeItemId: 'intake',
      archiveImportId: 'completed'
    })
    expect(f.tx.archiveRevision.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(f.tx.archiveIntakeItem.update).not.toHaveBeenCalled()
  })
  it.each(['unknown-total', 'stale', 'changed-media', 'active-import', 'capacity'] as const)(
    'refuses %s without freezing a completion intent',
    async (fault) => {
      const f = fixture()
      if (fault === 'unknown-total')
        {f.tx.archiveRevision.findUnique.mockResolvedValue({ ...f.base, sourceTotalItems: null } as never)}
      if (fault === 'stale')
        {f.tx.archiveRevision.findUniqueOrThrow.mockResolvedValue({ ...f.base, isCurrent: false } as never)}
      if (fault === 'changed-media') f.image.path = 'changed.png'
      if (fault === 'active-import') f.tx.archiveImport.count.mockResolvedValue(1)
      if (fault === 'capacity') f.tx.archiveIntakeItem.findFirst.mockResolvedValue(null as never)
      await expect(completeArchiveArtwork(input, 'admin', f.database)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
      expect(f.tx.archiveIntakeItem.update).not.toHaveBeenCalled()
    }
  )
  it('accepts only an artwork, expected revision and bounded idempotency key', () => {
    expect(completeArchiveArtworkSchema.safeParse({ ...input, quality: 'ORIGINAL' }).success).toBe(false)
    expect(completeArchiveArtworkSchema.safeParse({ ...input, idempotencyKey: 'x'.repeat(151) }).success).toBe(false)
  })
})
