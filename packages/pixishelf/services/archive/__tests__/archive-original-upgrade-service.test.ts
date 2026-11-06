import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getArchiveOriginalUpgrade,
  upgradeArchiveOriginal,
  upgradeArchiveOriginalSchema
} from '../archive-original-upgrade-service'

const { submit } = vi.hoisted(() => ({ submit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/services/archive-intake/archive-intake-service', () => ({
  createArchiveIntakeSubmissionInTransaction: submit
}))

function fixture(count = 25) {
  const media = Array.from({ length: count }, (_, index) => ({
    imageId: index + 1,
    index,
    path: `media/${index}.png`,
    size: '10',
    width: 2,
    height: 3,
    sha256: 'b'.repeat(64),
    mimeType: 'image/png'
  }))
  const base = {
    id: 'base',
    archiveImportId: 'published-task',
    artworkId: 7,
    sourceTotalItems: count,
    sourcePlanDigest: 'a'.repeat(64),
    isCurrent: true,
    retiredAt: null,
    downloadScope: 'ALL',
    archivePath: 'sources/gallery/base',
    metadataHash: 'c'.repeat(64),
    mediaSnapshot: media,
    qualityEvidence: null as unknown,
    externalRef: { canonicalUrl: 'https://e-hentai.org/g/123/token/', providerKey: 'e-hentai', externalId: '123' },
    archiveImport: {
      normalizedMetadata: { fileSize: 1_116_691_497 },
      selectedQuality: 'ORIGINAL',
      items: media.map((entry) => ({
        pageIndex: entry.index,
        sourcePageUrl: `https://e-hentai.org/s/page/123-${entry.index + 1}`,
        locator: { page: entry.index }
      })),
      intakeItems: []
    }
  }
  const images = media.map((entry) => ({
    id: entry.imageId,
    sortOrder: entry.index,
    path: `${base.archivePath}/${entry.path}`,
    size: 10n,
    contentSource: { revision: 2n, writeToken: null },
    chaptersPath: null
  }))
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 7, mediaRevision: 3 }]),
    $queryRawUnsafe: vi.fn(),
    archiveRevision: {
      findUnique: vi.fn().mockResolvedValue(base),
      findUniqueOrThrow: vi.fn().mockResolvedValue(base)
    },
    archiveIntakeItem: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'intake',
        status: 'QUEUED',
        upgradeBaseRevisionId: null,
        currentSystemJobId: 'resolve'
      }),
      update: vi.fn()
    },
    archiveImport: { count: vi.fn().mockResolvedValue(0) },
    systemJob: { update: vi.fn() },
    artwork: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 7,
        mediaRevision: 3,
        deletedAt: null,
        archiveLifecycleState: 'ACTIVE',
        storagePath: base.archivePath,
        images
      })
    }
  }
  return { tx, base, images, media, database: { $transaction: vi.fn((fn) => fn(tx)) } as never }
}
const input = { artworkId: 7, expectedRevisionId: 'base', idempotencyKey: 'request' }
beforeEach(() => submit.mockReset().mockResolvedValue({ id: 'submission' }))

describe('original archive upgrade command', () => {
  it('rejects unsupported providers before creating any submission', async () => {
    const f = fixture(2)
    f.base.externalRef.providerKey = 'other'
    await expect(upgradeArchiveOriginal(input, 'admin', f.database)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    expect(submit).not.toHaveBeenCalled()
  })
  it('returns the active revision quality summary only for E-Hentai', async () => {
    const f = fixture(2)
    const verifiedAt = new Date('2026-11-05T10:00:00Z')
    const database = {
      archiveRevision: {
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          ...f.base,
          qualityStatus: 'MIXED',
          qualityOriginalCount: 1,
          qualityDisplayCount: 1,
          qualityUnknownCount: 0,
          qualityVerifiedAt: verifiedAt,
          artwork: { imageCount: 2 }
        })
      },
      archiveIntakeItem: { findFirst: vi.fn().mockResolvedValue(null) }
    }
    await expect(getArchiveOriginalUpgrade(7, database as never)).resolves.toMatchObject({
      qualityTaskId: 'published-task',
      sourceSizeBytes: 1_116_691_497,
      quality: { status: 'MIXED', originalCount: 1, displayCount: 1, unknownCount: 0, verifiedAt }
    })
    expect(database.archiveRevision.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ externalRef: { providerKey: 'e-hentai' } }) })
    )
    expect(database.archiveRevision.findUnique).not.toHaveBeenCalled()
    const selection = database.archiveRevision.findFirst.mock.calls[0]![0] as { select: Record<string, unknown> }
    expect(selection.select).not.toHaveProperty('mediaSnapshot')
    expect(selection.select).not.toHaveProperty('qualityEvidence')
    expect(selection.select.archiveImport).toEqual({ select: { normalizedMetadata: true } })
  })
  it('loads historical source items only when a non-original revision lacks a frozen plan', async () => {
    const f = fixture(2)
    f.base.sourcePlanDigest = null as never
    f.base.sourceTotalItems = null as never
    const database = {
      archiveRevision: {
        findFirst: vi.fn().mockResolvedValue({ ...f.base, qualityStatus: 'UNKNOWN' }),
        findUnique: vi.fn().mockResolvedValue(f.base)
      },
      archiveIntakeItem: { findFirst: vi.fn().mockResolvedValue(null) }
    }
    await expect(getArchiveOriginalUpgrade(7, database as never)).resolves.toMatchObject({ canUpgrade: true })
    expect(database.archiveRevision.findUnique).toHaveBeenCalledOnce()
  })
  it.each([
    ['RETRY_WAIT', null, true],
    ['READY', null, true],
    ['ENQUEUED', 'PENDING', true],
    ['ENQUEUED', 'PAUSED', true],
    ['ENQUEUED', 'FAILED', false],
    ['FAILED', null, false]
  ] as const)('reports upgrade activity for intake %s and task %s', async (intakeStatus, taskStatus, active) => {
    const f = fixture(2)
    const database = {
      archiveRevision: {
        findFirst: vi.fn().mockResolvedValue({ ...f.base, qualityStatus: 'UNKNOWN' })
      },
      archiveIntakeItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'intake',
          status: intakeStatus,
          errorCode: null,
          errorMessage: null,
          archiveImport: taskStatus ? { id: 'task', status: taskStatus, errorCode: null, errorMessage: null } : null
        })
      }
    }
    await expect(getArchiveOriginalUpgrade(7, database as never)).resolves.toMatchObject({
      active,
      canUpgrade: !active,
      intakeItemId: 'intake',
      taskId: taskStatus ? 'task' : null
    })
  })
  it('freezes all current pages above twenty without trusting the old requested-quality label', async () => {
    const f = fixture()
    await expect(upgradeArchiveOriginal(input, 'admin', f.database)).resolves.toEqual({
      intakeItemId: 'intake',
      archiveImportId: null
    })
    const snapshot = f.tx.archiveIntakeItem.update.mock.calls[0]![0].data.upgradeSnapshot
    expect(snapshot.media).toHaveLength(25)
    expect(snapshot.media.every((entry: { originalEvidence?: unknown }) => !entry.originalEvidence)).toBe(true)
    expect(snapshot).toMatchObject({
      intent: 'ORIGINAL_UPGRADE',
      quality: 'ORIGINAL',
      downloadScope: 'ALL',
      sourceTotalItems: 25
    })
    expect(f.tx.systemJob.update).toHaveBeenCalledWith({ where: { id: 'resolve' }, data: { definitionVersion: 3 } })
  })
  it('preserves partial coverage and freezes only the local range', async () => {
    const f = fixture(20)
    f.base.downloadScope = 'FIRST_20'
    f.base.sourceTotalItems = 30
    await upgradeArchiveOriginal(input, 'admin', f.database)
    expect(submit.mock.calls[0]![0]).toMatchObject({ downloadScope: 'FIRST_20', quality: 'ORIGINAL' })
    expect(f.tx.archiveIntakeItem.update.mock.calls[0]![0].data.upgradeSnapshot).toMatchObject({
      downloadScope: 'FIRST_20',
      sourceTotalItems: 30,
      media: expect.any(Array)
    })
  })
  it('reuses only a page with aligned, verified original evidence', async () => {
    const f = fixture(2)
    f.base.qualityEvidence = {
      version: 1,
      pages: [
        {
          ...f.media[0],
          sourcePageUrl: f.base.archiveImport.items[0]!.sourcePageUrl,
          quality: 'ORIGINAL',
          reason: 'HATH_OM_ORIGINAL'
        }
      ]
    }
    await upgradeArchiveOriginal(input, 'admin', f.database)
    const snapshot = f.tx.archiveIntakeItem.update.mock.calls[0]![0].data.upgradeSnapshot
    expect(snapshot.media[0].originalEvidence.quality).toBe('ORIGINAL')
    expect(snapshot.media[1].originalEvidence).toBeUndefined()
  })
  it('derives an old full archive plan from its persisted source items', async () => {
    const f = fixture(2)
    f.base.sourcePlanDigest = null as never
    f.base.sourceTotalItems = null as never
    await upgradeArchiveOriginal(input, 'admin', f.database)
    expect(f.tx.archiveIntakeItem.update.mock.calls[0]![0].data.upgradeSnapshot).toMatchObject({
      sourceTotalItems: 2,
      sourcePlanDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
  })
  it.each(['stale', 'changed-media', 'missing-partial-plan', 'active-import'] as const)(
    'rejects %s before freezing an intent',
    async (fault) => {
      const f = fixture(2)
      if (fault === 'stale') f.base.isCurrent = false
      if (fault === 'changed-media') f.images[0]!.path = 'changed.png'
      if (fault === 'missing-partial-plan') {
        f.base.downloadScope = 'FIRST_20'
        f.base.sourcePlanDigest = null as never
        f.base.sourceTotalItems = null as never
      }
      if (fault === 'active-import') f.tx.archiveImport.count.mockResolvedValue(1)
      await expect(upgradeArchiveOriginal(input, 'admin', f.database)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
      expect(f.tx.archiveIntakeItem.update).not.toHaveBeenCalled()
    }
  )
  it('replays the accepted intent after the current version advances', async () => {
    const f = fixture(2)
    f.tx.archiveIntakeItem.findFirst.mockResolvedValue({
      id: 'intake',
      upgradeBaseRevisionId: 'base',
      archiveImportId: 'upgrade'
    } as never)
    f.base.isCurrent = false
    await expect(upgradeArchiveOriginal(input, 'admin', f.database)).resolves.toEqual({
      intakeItemId: 'intake',
      archiveImportId: 'upgrade'
    })
    expect(f.tx.archiveRevision.findUniqueOrThrow).not.toHaveBeenCalled()
  })
  it('takes no quality, path, locator or evidence from clients', () => {
    expect(upgradeArchiveOriginalSchema.safeParse({ ...input, quality: 'DISPLAY' }).success).toBe(false)
    expect(upgradeArchiveOriginalSchema.safeParse({ ...input, upgradeSnapshot: {} }).success).toBe(false)
  })
})
