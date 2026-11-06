import { describe, expect, it } from 'vitest'
import {
  getVerifiedOriginalPages,
  archiveQualityAuditPayloadSchema,
  archiveQualityEvidenceSchema
} from '../archive-quality.ts'

describe('archive quality proof readers', () => {
  const page = {
    imageId: 1,
    index: 0,
    path: 'media/0.jpg',
    size: '10',
    sha256: 'a'.repeat(64),
    sourcePageUrl: 'https://e-hentai.org/s/page/1-1',
    quality: 'ORIGINAL',
    reason: 'HATH_OM_ORIGINAL'
  }
  it('requires the evidence and media snapshot to have identical frozen identity', () => {
    const revision = { qualityEvidence: { version: 1, pages: [page] }, mediaSnapshot: [page] }
    expect(getVerifiedOriginalPages(revision).has(0)).toBe(true)
    for (const changed of [
      { imageId: 2 },
      { index: 1 },
      { path: 'other.jpg' },
      { size: '11' },
      { sha256: 'b'.repeat(64) }
    ]) {
      expect(getVerifiedOriginalPages({ ...revision, mediaSnapshot: [{ ...page, ...changed }] }).size).toBe(0)
    }
    expect(getVerifiedOriginalPages({ ...revision, qualityEvidence: null }).size).toBe(0)
    expect(getVerifiedOriginalPages({ ...revision, qualityEvidence: { version: 1, pages: [page, page] } }).size).toBe(0)
  })

  it('preserves current-match provenance without treating the ID as frozen for reuse', () => {
    const { imageId, ...legacyPage } = page
    const qualityEvidence = archiveQualityEvidenceSchema.parse({
      version: 1,
      pages: [{ ...legacyPage, imageId, evidence: { imageIdSource: 'CURRENT_IMAGE_PATH_ORDER_SIZE' } }]
    })
    expect(qualityEvidence.pages[0]?.evidence?.imageIdSource).toBe('CURRENT_IMAGE_PATH_ORDER_SIZE')
    expect(getVerifiedOriginalPages({ qualityEvidence, mediaSnapshot: [legacyPage] }).size).toBe(0)
  })

  it('freezes only a bounded database cursor in the audit payload', () => {
    expect(archiveQualityAuditPayloadSchema.parse({ targetMaxArtworkId: 20, targetArtworkCount: 10 })).toEqual({
      targetMaxArtworkId: 20,
      targetArtworkCount: 10
    })
    expect(
      archiveQualityAuditPayloadSchema.safeParse({ targetMaxArtworkId: 20, targetArtworkCount: 10, scanRoot: '/nas' })
        .success
    ).toBe(false)
  })
})
