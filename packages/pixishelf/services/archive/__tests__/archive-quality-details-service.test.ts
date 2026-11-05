import { describe, expect, it, vi } from 'vitest'
import { getArchiveQualityDetails } from '../archive-quality-service'

function page(index: number, reason = 'NO_FINAL_SUCCESSFUL_ATTEMPT', quality: 'ORIGINAL' | 'UNKNOWN' = 'UNKNOWN') {
  return {
    imageId: index + 1,
    index,
    path: `private/${index}.jpg`,
    size: '10',
    sha256: 'a'.repeat(64),
    sourcePageUrl: 'https://e-hentai.org/s/private-token/1-1',
    quality,
    reason,
    evidence: { downloadUrl: 'https://node.hath.network/private-token' }
  }
}

describe('archive quality details without a retained source task', () => {
  it('paginates unknown page reasons and never returns signed URLs, paths, hashes or arbitrary reason text', async () => {
    const database = {
      archiveRevision: {
        findFirst: vi
          .fn()
          .mockResolvedValue({
            id: 'revision',
            archiveImportId: null,
            qualityVerifiedAt: new Date(),
            qualityEvidence: {
              version: 1,
              pages: [
                page(0),
                page(1, 'https://secret.example/token'),
                page(2, 'HATH_OM_ORIGINAL', 'ORIGINAL'),
                page(3)
              ]
            }
          })
      }
    }
    const result = await getArchiveQualityDetails({ artworkId: 7, offset: 1, limit: 1 }, database as never)
    expect(result).toEqual({
      revisionId: 'revision',
      reason: null,
      unresolvedPageCount: 0,
      total: 3,
      pages: [{ index: 1, quality: 'UNKNOWN', reason: 'NO_VERIFIED_DELIVERY_EVIDENCE' }],
      nextOffset: 2
    })
    expect(JSON.stringify(result)).not.toMatch(/private|secret|hath|sha256|sourcePageUrl/)
    const last = await getArchiveQualityDetails({ artworkId: 7, offset: 2, limit: 1 }, database as never)
    expect(last).toMatchObject({ pages: [{ index: 3 }], nextOffset: null })
  })
  it('returns a whole-revision reason with the true unresolved count when no valid page snapshot exists', async () => {
    const database = {
      archiveRevision: {
        findFirst: vi
          .fn()
          .mockResolvedValue({
            id: 'revision',
            qualityVerifiedAt: new Date(),
            qualityEvidence: { version: 1, reason: 'INVALID_MEDIA_SNAPSHOT', unresolvedPageCount: 232, pages: [] }
          })
      }
    }
    expect(await getArchiveQualityDetails({ artworkId: 7, offset: 0, limit: 50 }, database as never)).toMatchObject({
      reason: 'INVALID_MEDIA_SNAPSHOT',
      unresolvedPageCount: 232,
      total: 0,
      pages: []
    })
  })
  it('explains a missing audit without requiring an import task', async () => {
    const database = {
      archiveRevision: {
        findFirst: vi.fn().mockResolvedValue({ id: 'revision', qualityVerifiedAt: null, qualityEvidence: null })
      }
    }
    expect(await getArchiveQualityDetails({ artworkId: 7, offset: 0, limit: 50 }, database as never)).toMatchObject({
      reason: 'NOT_AUDITED',
      pages: []
    })
  })
})
