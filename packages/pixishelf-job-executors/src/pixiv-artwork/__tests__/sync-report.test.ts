import { describe, expect, it } from 'vitest'
import { PIXIV_ARTWORK_SYNC_REPORT_TEXT_PREVIEW_LIMIT } from '@pixishelf/job-contracts'
import { buildPixivArtworkSyncReport, type PixivArtworkSyncTrackedState } from '../sync-report.ts'

describe('Pixiv artwork sync report', () => {
  it('distinguishes database updates, snapshot-only updates and unchanged runs', () => {
    const before = state()
    const updated = build({ beforeState: before, afterState: { ...before, bookmarkCount: 7 } })
    const snapshotOnly = build({
      beforeState: before,
      afterState: before,
      beforeSnapshot: snapshot('a'),
      afterSnapshot: snapshot('b')
    })
    const unchanged = build({
      beforeState: before,
      afterState: before,
      beforeSnapshot: snapshot('a'),
      afterSnapshot: snapshot('a')
    })

    expect(updated).toMatchObject({ changeKind: 'UPDATED', fields: [{ key: 'bookmarkCount' }] })
    expect(snapshotOnly.changeKind).toBe('SNAPSHOT_ONLY')
    expect(unchanged.changeKind).toBe('UNCHANGED')
  })

  it('records exact tag ownership changes and protects oversized text values', () => {
    const longDescription = 'x'.repeat(PIXIV_ARTWORK_SYNC_REPORT_TEXT_PREVIEW_LIMIT + 10)
    const report = build({
      beforeState: state({ description: longDescription }),
      afterState: state({ description: 'new' }),
      beforeTags: ['old', 'shared'],
      afterTags: ['new', 'shared']
    })

    expect(report.tags).toMatchObject({ added: ['new'], removed: ['old'] })
    expect(report.fields[0]?.before).toMatchObject({
      truncated: true,
      originalLength: longDescription.length,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
  })
})

function build(
  overrides: Partial<Parameters<typeof buildPixivArtworkSyncReport>[0]> = {}
) {
  return buildPixivArtworkSyncReport({
    jobId: 'job-1',
    artworkId: 1,
    externalRefId: 'ref-1',
    pixivArtworkId: '123',
    checkedAt: new Date('2026-08-26T00:00:00.000Z'),
    refreshExisting: false,
    status: 'SUCCESS',
    beforeState: state(),
    afterState: state(),
    beforeTags: [],
    afterTags: [],
    protectedFields: [],
    beforeSnapshot: null,
    afterSnapshot: snapshot('a'),
    ...overrides
  })
}

function snapshot(character: string) {
  const hash = character.repeat(64)
  return { hash, path: `artworks/123/metadata/${hash}.json` }
}

function state(overrides: Partial<PixivArtworkSyncTrackedState> = {}): PixivArtworkSyncTrackedState {
  return {
    title: 'Title',
    description: null,
    titleOverridden: false,
    descriptionOverridden: false,
    bookmarkCount: null,
    isAiGenerated: null,
    originalUrl: null,
    size: null,
    sourceDate: null,
    sourceUrl: null,
    thumbnailUrl: null,
    xRestrict: null,
    pixivAiType: null,
    pixivType: null,
    sanityLevel: null,
    ...overrides
  }
}
