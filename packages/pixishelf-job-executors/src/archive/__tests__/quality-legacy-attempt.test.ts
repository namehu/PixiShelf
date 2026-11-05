import { describe, expect, it } from 'vitest'
import { buildArchiveQualityEvidence, summarizeArchiveQuality } from '../quality-evidence.ts'

describe('legacy snapshot with missing download provenance', () => {
  it('keeps saved pages unknown when no final delivery attempt was recorded', () => {
    const sha256 = 'a'.repeat(64)
    const media = { index: 0, path: 'media/1.jpg', size: '100', width: 1280, height: 900, sha256, mimeType: 'image/jpeg' }
    const revision = {
      archivePath: 'archive/revision',
      isCurrent: true,
      mediaSnapshot: [media],
      archiveImport: {
        id: 'import', completionSnapshot: null, upgradeSnapshot: null,
        items: [{ pageIndex: 0, sourcePageUrl: null, status: 'COMPLETED', stagedPath: media.path,
          byteCount: 100n, sha256, width: 1280, height: 900, mimeType: 'image/jpeg',
          attempts: 1, lastDownloadUrl: null, lastDownloadAt: null, lastDownloadAttempt: null,
          startedAt: new Date('2026-01-01T00:00:00Z'), finishedAt: new Date('2026-01-01T00:00:01Z'), deliveryEvidence: null }]
      }
    } as unknown as Parameters<typeof buildArchiveQualityEvidence>[0]
    const evidence = buildArchiveQualityEvidence(revision, [
      { id: 5, path: 'archive/revision/media/1.jpg', sortOrder: 0, size: 100n }
    ])
    expect(evidence.pages[0]).toMatchObject({ imageId: 5, quality: 'UNKNOWN', reason: 'NO_FINAL_SUCCESSFUL_ATTEMPT' })
    expect(summarizeArchiveQuality(evidence)).toMatchObject({
      qualityStatus: 'UNKNOWN', qualityOriginalCount: 0, qualityDisplayCount: 0, qualityUnknownCount: 1
    })
  })
})
