import { describe, expect, it, vi } from 'vitest'
import { verifiedOriginalArchiveCheckpointIds } from '../download-generation.js'
import type { LoadedArchiveImport } from '../executor.js'

const sha256 = 'a'.repeat(64)
const sourcePageUrl = 'https://e-hentai.org/s/key/123-1'
const image = {
  imageId: 1,
  index: 0,
  path: 'media/first.png',
  size: '100',
  sha256,
  width: 2,
  height: 3,
  mimeType: 'image/png'
}
const item = {
  id: 'item-1',
  pageIndex: 0,
  status: 'COMPLETED',
  quality: 'ORIGINAL',
  sourcePageUrl,
  stagedPath: image.path,
  byteCount: 100n,
  sha256,
  width: 2,
  height: 3,
  mimeType: 'image/png',
  attempts: 0,
  lastDownloadUrl: null,
  lastDownloadAt: null,
  lastDownloadAttempt: null,
  startedAt: null,
  finishedAt: new Date('2026-11-05'),
  deliveryEvidence: null
}
const frozen = {
  artworkId: 1,
  revisionId: 'base',
  archivePath: 'sources/base',
  metadataHash: 'metadata',
  sourcePlanDigest: 'a'.repeat(64),
  sourceTotalItems: 30,
  mediaRevision: 1,
  quality: 'ORIGINAL',
  media: [{ ...image, imagePath: 'sources/base/media/first.png', contentRevision: '0' }]
}

function archive(overrides: Partial<LoadedArchiveImport> = {}): LoadedArchiveImport {
  return {
    items: [item],
    upgradeBaseRevisionId: null,
    upgradeSnapshot: null,
    completionBaseRevisionId: null,
    completionSnapshot: null,
    ...overrides
  } as LoadedArchiveImport
}

describe('strict original checkpoint reuse', () => {
  it('does not trust a historical requested ORIGINAL label without a successful delivery record', async () => {
    expect(await verifiedOriginalArchiveCheckpointIds({} as never, archive())).toEqual(new Set())
  })

  it('retains a historical checkpoint whose actual facts match a proven H@H original', async () => {
    const delivered = {
      ...item,
      attempts: 1,
      startedAt: new Date('2026-11-04'),
      lastDownloadAt: new Date('2026-11-04T12:00:00Z'),
      lastDownloadAttempt: 1,
      lastDownloadUrl: `https://node.hath.network/om/1/${'b'.repeat(40)}-100-2-3-png/x/0/file.png`
    }
    expect(await verifiedOriginalArchiveCheckpointIds({} as never, archive({ items: [delivered] } as never))).toEqual(
      new Set(['item-1'])
    )
  })

  it.each(['ORIGINAL', 'UNKNOWN'])(
    'reuses a completion prefix only through the verified base evidence: %s',
    async (quality) => {
      const database = {
        archiveRevision: {
          findUnique: vi.fn(async () => ({
            mediaSnapshot: [image],
            qualityEvidence: {
              version: 1,
              pages: [{ ...image, sourcePageUrl, quality, reason: 'HATH_OM_ORIGINAL' }]
            }
          }))
        }
      }
      const result = await verifiedOriginalArchiveCheckpointIds(
        database as never,
        archive({ completionBaseRevisionId: 'base', completionSnapshot: frozen })
      )
      expect(result.has('item-1')).toBe(quality === 'ORIGINAL')
    }
  )

  it('does not inherit an original proof after the frozen source page changes', async () => {
    const database = {
      archiveRevision: {
        findUnique: vi.fn(async () => ({
          mediaSnapshot: [image],
          qualityEvidence: {
            version: 1,
            pages: [
              {
                ...image,
                sourcePageUrl: 'https://e-hentai.org/s/other/123-2',
                quality: 'ORIGINAL',
                reason: 'HATH_OM_ORIGINAL'
              }
            ]
          }
        }))
      }
    }
    expect(
      await verifiedOriginalArchiveCheckpointIds(
        database as never,
        archive({ completionBaseRevisionId: 'base', completionSnapshot: frozen })
      )
    ).toEqual(new Set())
  })
})
