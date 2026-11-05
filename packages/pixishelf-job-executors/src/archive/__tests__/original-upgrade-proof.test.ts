import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@pixishelf/db'
import { readPartialRetirementSnapshot } from '../retire-partial-proof.ts'
import { assertArchiveOriginalUpgradeBase } from '../original-upgrade-proof.ts'

vi.mock('@pixishelf/db', async (original) => ({
  ...(await original<typeof import('@pixishelf/db')>()),
  lockCreatorCatalog: vi.fn(),
  lockArtworkForReading: vi.fn(),
  assertNoArtworkDedupArchiveSourceHold: vi.fn(),
  assertArtworkDedupWritable: vi.fn()
}))

function fixture() {
  const oldMedia = {
    imageId: 1,
    index: 0,
    path: 'media/display.png',
    imagePath: 'old/media/display.png',
    contentRevision: '0',
    sha256: 'a'.repeat(64),
    size: '20',
    width: 2,
    height: 3,
    mimeType: 'image/png'
  }
  const frozen = {
    intent: 'ORIGINAL_UPGRADE',
    artworkId: 7,
    revisionId: 'old',
    archivePath: 'old',
    metadataHash: 'c',
    sourcePlanDigest: 'd'.repeat(64),
    sourceTotalItems: 30,
    mediaRevision: 1,
    quality: 'ORIGINAL',
    downloadScope: 'FIRST_20',
    media: [oldMedia]
  }
  const newMedia = { ...oldMedia, path: 'media/original.png', sha256: 'b'.repeat(64), size: '40' }
  delete (newMedia as Partial<typeof newMedia>).imagePath
  delete (newMedia as Partial<typeof newMedia>).contentRevision
  const old = {
    id: 'old',
    artworkId: 7,
    isCurrent: false,
    downloadScope: 'FIRST_20',
    archivePath: 'old',
    retirementRequestedAt: new Date(),
    replacedByRevisionId: 'new',
    retirementSnapshot: frozen,
    archiveImport: {
      id: 'old',
      providerKey: 'e-hentai',
      externalId: '1',
      selectedQuality: 'DISPLAY',
      sealedManifestSha256: null
    }
  }
  const replacement = {
    id: 'new',
    artworkId: 7,
    isCurrent: true,
    downloadScope: 'FIRST_20',
    archivePath: 'new',
    sourceTotalItems: 30,
    sourcePlanDigest: frozen.sourcePlanDigest,
    mediaSnapshot: [newMedia],
    artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE', storagePath: 'new' },
    archiveImport: {
      id: 'new',
      selectedQuality: 'ORIGINAL',
      sealedManifestSha256: 'e'.repeat(64),
      upgradeBaseRevisionId: 'old'
    },
    qualityEvidence: {
      version: 1,
      pages: [
        {
          ...newMedia,
          sourcePageUrl: 'https://e-hentai.org/s/token/1-1',
          quality: 'ORIGINAL',
          reason: 'HATH_OM_ORIGINAL'
        }
      ]
    }
  }
  const tx = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ count: 0n }]),
    archiveRevision: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'old' ? old : replacement)
      )
    },
    image: { count: vi.fn().mockResolvedValue(0) },
    artwork: { count: vi.fn().mockResolvedValue(0) },
    archiveImport: { count: vi.fn().mockResolvedValue(0) },
    migrationJobItem: { count: vi.fn().mockResolvedValue(0) }
  }
  return { old, replacement, frozen, tx: tx as unknown as Prisma.TransactionClient }
}

describe('original upgrade frozen publication and retirement proofs', () => {
  it('retires a display revision after independently proven original bytes change hash, length and path', async () => {
    const f = fixture()
    await expect(
      readPartialRetirementSnapshot(f.tx, {
        action: 'RETIRE_ORIGINAL_REVISION',
        revisionId: 'old',
        replacementRevisionId: 'new'
      })
    ).resolves.toMatchObject({ old: { id: 'old' }, replacement: { id: 'new' } })
  })
  it.each(['unproven', 'identity', 'coverage', 'wrong-intent'] as const)(
    'keeps old files when replacement proof is %s',
    async (fault) => {
      const f = fixture()
      if (fault === 'unproven') f.replacement.qualityEvidence.pages[0]!.quality = 'UNKNOWN'
      if (fault === 'identity') f.replacement.mediaSnapshot[0]!.imageId = 2
      if (fault === 'coverage') f.replacement.downloadScope = 'ALL'
      if (fault === 'wrong-intent') f.replacement.archiveImport.upgradeBaseRevisionId = 'other'
      await expect(
        readPartialRetirementSnapshot(f.tx, {
          action: 'RETIRE_ORIGINAL_REVISION',
          revisionId: 'old',
          replacementRevisionId: 'new'
        })
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    }
  )
  it('does not relax ordinary completion into accepting changed existing-page bytes', async () => {
    const f = fixture()
    await expect(
      readPartialRetirementSnapshot(f.tx, {
        action: 'RETIRE_PARTIAL_REVISION',
        revisionId: 'old',
        replacementRevisionId: 'new'
      })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })
  it('rejects a changed local image before publication', async () => {
    const f = fixture()
    const tx = {
      archiveRevision: {
        findUnique: vi.fn().mockResolvedValue({ ...f.old, isCurrent: true, retiredAt: null, metadataHash: 'c' })
      },
      artwork: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 7,
            mediaRevision: 1,
            storagePath: 'old',
            archiveLifecycleState: 'ACTIVE',
            deletedAt: null
          })
      },
      image: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 1, path: 'changed', sortOrder: 0, size: 20n, chaptersPath: null, contentSource: null }
          ])
      }
    }
    await expect(
      assertArchiveOriginalUpgradeBase(tx as unknown as Prisma.TransactionClient, {
        upgradeBaseRevisionId: 'old',
        upgradeSnapshot: f.frozen
      })
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })
})
