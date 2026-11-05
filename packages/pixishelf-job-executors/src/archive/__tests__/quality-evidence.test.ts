import { describe, expect, it } from 'vitest'
import {
  buildArchiveQualityEvidence,
  classifyArchiveCompletedDelivery,
  summarizeArchiveQuality
} from '../quality-evidence.ts'

const sha256 = 'a'.repeat(64)
const sha1 = 'b'.repeat(40)
const originalUrl = `https://node.hath.network/om/1/${sha1}-100-1280-900-jpg/x/file.jpg`
const media = {
  imageId: 5,
  index: 0,
  path: 'media/1.jpg',
  size: '100',
  sha256,
  width: 1280,
  height: 900,
  mimeType: 'image/jpeg'
}
const image = { id: 5, path: 'archive/revision/media/1.jpg', sortOrder: 0, size: 100n }
const item = {
  pageIndex: 0,
  sourcePageUrl: 'https://e-hentai.org/s/token/123-1',
  status: 'COMPLETED' as const,
  stagedPath: media.path,
  byteCount: 100n,
  sha256,
  width: 1280,
  height: 900,
  mimeType: 'image/jpeg',
  attempts: 2,
  lastDownloadAttempt: 2,
  lastDownloadUrl: originalUrl,
  lastDownloadAt: new Date('2026-11-05T00:00:00Z'),
  startedAt: new Date('2026-11-04T23:59:59Z'),
  finishedAt: new Date('2026-11-05T00:00:01Z'),
  deliveryEvidence: null
}
function revision(itemChanges: Record<string, unknown> = {}, changes: Record<string, unknown> = {}) {
  return {
    id: 'revision',
    archivePath: 'archive/revision',
    mediaSnapshot: [media],
    isCurrent: true,
    archiveImport: {
      id: 'import',
      selectedQuality: 'ORIGINAL',
      completionSnapshot: null,
      upgradeSnapshot: null,
      items: [{ ...item, ...itemChanges }]
    },
    ...changes
  } as unknown as Parameters<typeof buildArchiveQualityEvidence>[0]
}

describe('database-only archive quality evidence', () => {
  it('recognizes an original from the final successful attempt and binds the frozen image identity', () => {
    expect(buildArchiveQualityEvidence(revision(), [image]).pages[0]).toMatchObject({
      quality: 'ORIGINAL',
      reason: 'HATH_OM_ORIGINAL',
      imageId: 5,
      sha256,
      evidence: { archiveImportId: 'import', attempt: 2, downloadUrl: originalUrl }
    })
  })

  it('reports a derivative even when the requested preference was ORIGINAL', () => {
    const downloadUrl = `https://node.hath.network/om/1/${'c'.repeat(40)}-200-2000-1500-jpg/${sha1}-100-1280-900-jpg/file.jpg`
    const evidence = buildArchiveQualityEvidence(revision({ lastDownloadUrl: downloadUrl }), [image])
    expect(evidence.pages[0]).toMatchObject({ quality: 'DISPLAY', reason: 'HATH_OM_DERIVATIVE' })
    expect(summarizeArchiveQuality(evidence)).toMatchObject({ qualityStatus: 'DISPLAY', qualityDisplayCount: 1 })
  })

  it.each([
    [{ lastDownloadAttempt: 1 }, 'NO_FINAL_SUCCESSFUL_ATTEMPT'],
    [{ lastDownloadUrl: null }, 'NO_FINAL_SUCCESSFUL_ATTEMPT'],
    [{ startedAt: null }, 'NO_FINAL_SUCCESSFUL_ATTEMPT'],
    [{ startedAt: new Date('2026-11-05T00:00:00.500Z') }, 'NO_FINAL_SUCCESSFUL_ATTEMPT'],
    [{ status: 'FAILED' }, 'SUCCESSFUL_ITEM_MISMATCH'],
    [{ sha256: 'c'.repeat(64) }, 'SUCCESSFUL_ITEM_MISMATCH'],
    [{ byteCount: 200n }, 'SUCCESSFUL_ITEM_MISMATCH'],
    [{ lastDownloadUrl: `https://untrusted.example/${sha1}-100-1280-900-jpg` }, 'NO_TRUSTED_HATH_EVIDENCE']
  ])('leaves insufficient or conflicting historical evidence unknown', (changes, reason) => {
    expect(buildArchiveQualityEvidence(revision(changes), [image]).pages[0]).toMatchObject({
      quality: 'UNKNOWN',
      reason
    })
  })

  it.each([
    { ...image, id: 6 },
    { ...image, path: 'wrong/path.jpg' },
    { ...image, sortOrder: 1 },
    { ...image, size: 200n }
  ])('rejects current image identity mismatches', (changed) => {
    expect(buildArchiveQualityEvidence(revision(), [changed]).pages[0]).toMatchObject({
      quality: 'UNKNOWN',
      reason: 'CURRENT_IMAGE_IDENTITY_MISMATCH'
    })
  })

  it('accepts a standard /h/ path xres but does not trust a query-only xres', () => {
    const url = `https://node.hath.network/h/${sha1}-100-1280-900-jpg/keystamp=1;xres=org/file.jpg`
    expect(buildArchiveQualityEvidence(revision({ lastDownloadUrl: url }), [image]).pages[0]?.quality).toBe('ORIGINAL')
    expect(
      buildArchiveQualityEvidence(revision({ lastDownloadUrl: url.replace(';xres=org', '') + '?xres=org' }), [image])
        .pages[0]?.quality
    ).toBe('UNKNOWN')
  })

  it('inherits only a frozen reused page with the same source page, index, SHA and bytes', () => {
    const prior = buildArchiveQualityEvidence(revision(), [image])
    const reused = revision({ attempts: 0, lastDownloadAttempt: null, lastDownloadUrl: null })
    reused.archiveImport!.completionSnapshot = { media: [{ index: 0, sha256, size: '100' }] }
    const previous = [{ revisionId: 'older', pages: prior.pages }]
    expect(buildArchiveQualityEvidence(reused, [image], previous).pages[0]).toMatchObject({
      quality: 'ORIGINAL',
      reason: 'FROZEN_PAGE_REUSE',
      evidence: { inheritedFromRevisionId: 'older' }
    })
    reused.archiveImport!.items[0]!.sourcePageUrl = 'https://e-hentai.org/s/changed/123-1'
    expect(buildArchiveQualityEvidence(reused, [image], previous).pages[0]?.quality).toBe('UNKNOWN')
  })

  it('replays a new original receipt with frozen provider metadata and verifies its file binding', () => {
    const downloadUrl = 'https://node.hath.network/unknown/original.jpg'
    const deliveryEvidence = {
      version: 1,
      quality: 'ORIGINAL',
      reason: 'EH_EXPLICIT_ORIGINAL_METADATA_MATCH',
      sha256,
      byteCount: '100',
      attempt: 2,
      downloadUrl,
      actualSha1: sha1,
      originalClaim: { width: 1280, height: 900, minBytes: 99, maxBytes: 101 }
    }
    expect(
      buildArchiveQualityEvidence(revision({ lastDownloadUrl: downloadUrl, deliveryEvidence }), [image]).pages[0]
        ?.quality
    ).toBe('ORIGINAL')
    expect(
      buildArchiveQualityEvidence(
        revision({ lastDownloadUrl: downloadUrl, deliveryEvidence: { ...deliveryEvidence, attempt: 1 } }),
        [image]
      ).pages[0]
    ).toMatchObject({ quality: 'UNKNOWN', reason: 'DELIVERY_RECEIPT_MISMATCH' })
  })

  it.each([
    [800, '800', 'DISPLAY', 'HATH_H_XRES_DISPLAY'],
    [900, '1280', 'UNKNOWN', 'HATH_H_XRES_WIDTH_MISMATCH'],
    [920, '920', 'UNKNOWN', 'HATH_H_UNSUPPORTED_XRES']
  ])('reaudits the old conflict result at width %s and xres=%s', (width, xres, quality, reason) => {
    const downloadUrl = `https://node.hath.network/h/${sha1}-100-${width}-900-jpg/key;xres=${xres}/file.jpg`
    const deliveryEvidence = {
      version: 1,
      quality: 'UNKNOWN',
      reason: 'CONFLICTING_HATH_XRES',
      sha256,
      byteCount: '100',
      attempt: 2,
      downloadUrl,
      actualSha1: sha1
    }
    const mediaRevision = revision(
      { width, lastDownloadUrl: downloadUrl, deliveryEvidence },
      { mediaSnapshot: [{ ...media, width }] }
    )
    expect(buildArchiveQualityEvidence(mediaRevision, [image]).pages[0]).toMatchObject({
      quality,
      reason,
      evidence: { archiveImportId: 'import', attempt: 2, downloadUrl }
    })
  })

  it('only accepts the legacy reason if it is reproducible with the bound receipt and file facts', () => {
    const downloadUrl = `https://node.hath.network/h/${sha1}-100-800-900-jpg/key;xres=800/file.jpg`
    const receipt = {
      version: 1,
      quality: 'UNKNOWN',
      reason: 'CONFLICTING_HATH_XRES',
      sha256,
      byteCount: '100',
      attempt: 2,
      downloadUrl,
      actualSha1: sha1
    }
    const completed = { ...item, status: 'COMPLETED' as const, lastDownloadUrl: downloadUrl, width: 800 }
    expect(
      classifyArchiveCompletedDelivery({ ...completed, deliveryEvidence: { ...receipt, sha256: 'c'.repeat(64) } })
    ).toEqual({ quality: 'UNKNOWN', reason: 'DELIVERY_RECEIPT_MISMATCH' })
    expect(
      classifyArchiveCompletedDelivery({ ...completed, deliveryEvidence: { ...receipt, actualSha1: 'c'.repeat(40) } })
    ).toEqual({ quality: 'UNKNOWN', reason: 'DELIVERY_CLASSIFICATION_MISMATCH' })
    const unchangedPolicyUrl = downloadUrl.replaceAll('800', '1280')
    expect(
      classifyArchiveCompletedDelivery({
        ...completed,
        lastDownloadUrl: unchangedPolicyUrl,
        width: 1280,
        deliveryEvidence: { ...receipt, downloadUrl: unchangedPolicyUrl }
      })
    ).toEqual({ quality: 'UNKNOWN', reason: 'DELIVERY_CLASSIFICATION_MISMATCH' })
  })

  it('replays a same-attempt display comparison without assigning a version to old receipts that lack it', () => {
    const downloadUrl = `https://node.hath.network/h/${sha1}-100-1280-900-jpg/key;xres=1600/file.jpg`
    const sourceOriginalClaim = { width: 2048, height: 1440, minBytes: 190, maxBytes: 210 }
    const receipt = { version: 1, sha256, byteCount: '100', attempt: 2, downloadUrl, actualSha1: sha1 }
    const legacyReceipt = { ...receipt, quality: 'UNKNOWN', reason: 'HATH_H_XRES_WIDTH_MISMATCH' }
    const displayReceipt = {
      ...receipt,
      quality: 'DISPLAY',
      reason: 'EH_DISPLAY_DIFFERS_FROM_ORIGINAL_DECLARATION',
      sourceOriginalClaim
    }
    expect(
      buildArchiveQualityEvidence(revision({ lastDownloadUrl: downloadUrl, deliveryEvidence: legacyReceipt }), [image])
        .pages[0]
    ).toMatchObject({
      quality: 'UNKNOWN',
      reason: 'HATH_H_XRES_WIDTH_MISMATCH'
    })
    expect(
      buildArchiveQualityEvidence(revision({ lastDownloadUrl: downloadUrl, deliveryEvidence: displayReceipt }), [image])
        .pages[0]
    ).toMatchObject({
      quality: 'DISPLAY',
      reason: 'EH_DISPLAY_DIFFERS_FROM_ORIGINAL_DECLARATION',
      evidence: { archiveImportId: 'import', attempt: 2, actualSha1: sha1, sourceOriginalClaim }
    })
    const completed = { ...item, lastDownloadUrl: downloadUrl }
    for (const changes of [
      { attempt: 1 },
      { downloadUrl: originalUrl },
      { sha256: 'c'.repeat(64) },
      { byteCount: '101' },
      { sourceOriginalClaim: { ...sourceOriginalClaim, minBytes: 211 } }
    ]) {
      expect(
        classifyArchiveCompletedDelivery({ ...completed, deliveryEvidence: { ...displayReceipt, ...changes } })
      ).toEqual({ quality: 'UNKNOWN', reason: 'DELIVERY_RECEIPT_MISMATCH' })
    }
    for (const deliveryEvidence of [
      { ...displayReceipt, actualSha1: 'c'.repeat(40) },
      { ...receipt, quality: displayReceipt.quality, reason: displayReceipt.reason },
      { ...displayReceipt, quality: 'UNKNOWN', reason: 'CONFLICTING_HATH_XRES' }
    ]) {
      expect(classifyArchiveCompletedDelivery({ ...completed, deliveryEvidence })).toEqual({
        quality: 'UNKNOWN',
        reason: 'DELIVERY_CLASSIFICATION_MISMATCH'
      })
    }
  })

  it('uses a fresh original delivery receipt before an older same-byte display classification', () => {
    const previous = buildArchiveQualityEvidence(revision(), [image])
    previous.pages[0]!.quality = 'DISPLAY'
    const fresh = revision()
    fresh.archiveImport!.upgradeSnapshot = { media: [{ index: 0, sha256, size: '100' }] }
    expect(
      buildArchiveQualityEvidence(fresh, [image], [{ revisionId: 'older', pages: previous.pages }]).pages[0]
    ).toMatchObject({ quality: 'ORIGINAL', reason: 'HATH_OM_ORIGINAL' })
  })

  it('replays an HTTP MIME conflict through the same shared classification rules', () => {
    const deliveryEvidence = {
      version: 1,
      quality: 'UNKNOWN',
      reason: 'RESPONSE_MIME_CONFLICTS_WITH_FILE',
      sha256,
      byteCount: '100',
      attempt: 2,
      downloadUrl: originalUrl,
      actualSha1: sha1,
      responseMimeType: 'image/png'
    }
    expect(buildArchiveQualityEvidence(revision({ deliveryEvidence }), [image]).pages[0]).toMatchObject({
      quality: 'UNKNOWN',
      reason: 'RESPONSE_MIME_CONFLICTS_WITH_FILE',
      evidence: { responseMimeType: 'image/png' }
    })
  })

  it('distinguishes mixed verified pages from incomplete verification', () => {
    const original = buildArchiveQualityEvidence(revision(), [image]).pages[0]!
    expect(
      summarizeArchiveQuality({ version: 1, pages: [original, { ...original, index: 1, quality: 'DISPLAY' }] })
        .qualityStatus
    ).toBe('MIXED')
    expect(
      summarizeArchiveQuality({ version: 1, pages: [original, { ...original, index: 1, quality: 'UNKNOWN' }] })
        .qualityStatus
    ).toBe('UNKNOWN')
  })

  it('counts every current page as unresolved when the frozen snapshot is missing or damaged', () => {
    const images = Array.from({ length: 232 }, (_, index) => ({ ...image, id: index + 1, sortOrder: index }))
    for (const mediaSnapshot of [null, { broken: true }, []]) {
      const evidence = buildArchiveQualityEvidence(revision({}, { mediaSnapshot }), images)
      expect(evidence).toMatchObject({ reason: 'INVALID_MEDIA_SNAPSHOT', pages: [], unresolvedPageCount: 232 })
      expect(summarizeArchiveQuality(evidence)).toMatchObject({
        qualityStatus: 'UNKNOWN',
        qualityOriginalCount: 0,
        qualityUnknownCount: 232
      })
    }
  })

  it('does not omit an extra current image absent from an otherwise proven snapshot', () => {
    const evidence = buildArchiveQualityEvidence(revision(), [image, { ...image, id: 6, sortOrder: 1 }])
    expect(evidence).toMatchObject({ reason: 'CURRENT_MEDIA_SET_MISMATCH', pages: [], unresolvedPageCount: 2 })
    expect(summarizeArchiveQuality(evidence)).toMatchObject({
      qualityStatus: 'UNKNOWN',
      qualityOriginalCount: 0,
      qualityUnknownCount: 2
    })
  })
})
