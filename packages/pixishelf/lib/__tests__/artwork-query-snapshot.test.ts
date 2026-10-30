import { describe, expect, it, vi } from 'vitest'
import {
  artworkQuerySnapshotSchema,
  quickFilterNameSchema,
  quickFilterSetNavigationSchema
} from '@/schemas/artwork-quick-filter.dto'
import { updateUserSettingItemSchema } from '@/schemas/user-setting.dto'
import { describeSnapshot, queryToSnapshot, snapshotHref, snapshotToQuery } from '../artwork-query-snapshot'

describe('saved artwork queries', () => {
  it('round trips the entire query, including labels with commas, percent signs and Unicode', () => {
    const query = artworkQuerySnapshotSchema.parse({
      search: '100% & 漫画',
      readingStatus: 'IN_PROGRESS',
      ratingLevels: [4, 2],
      excludedArtists: [
        { value: '7', label: '合作者,A%中文' },
        { value: '8', label: '另一位' }
      ],
      artist: [{ value: '42', label: '艺术家' }],
      tags: [{ value: '9', label: 'A,B% 中文' }],
      sources: ['LOCAL_IMPORT'],
      mediaType: 'animation',
      hasAudio: 'no',
      sortBy: 'created_at_desc',
      startDate: '2026-01-01',
      endDate: '2026-10-14',
      createdStartDate: '2026-02-01'
    })
    expect(queryToSnapshot(new URL(snapshotHref(query), 'http://localhost').searchParams)).toEqual(query)
    expect(snapshotToQuery(artworkQuerySnapshotSchema.parse({}))).toMatchObject({
      search: null,
      artistId: null,
      tags: null,
      startDate: null,
      hasAudio: 'all',
      readingStatus: 'all',
      randomSeed: null
    })
  })
  it('keeps old links and presets unfiltered and describes saved likes', () => {
    const legacy = artworkQuerySnapshotSchema.parse({})
    expect(legacy.likedOnly).toBe(false)
    expect(snapshotToQuery(legacy).likedOnly).toBeNull()
    expect(snapshotHref(legacy)).not.toContain('likedOnly')
    expect(queryToSnapshot(new URLSearchParams('likedOnly=false')).likedOnly).toBe(false)
    expect(queryToSnapshot(new URLSearchParams('likedOnly=invalid')).likedOnly).toBe(false)
    expect(describeSnapshot(artworkQuerySnapshotSchema.parse({ likedOnly: true }))).toContain('喜欢、超爱、夯爆了')
    expect(artworkQuerySnapshotSchema.safeParse({ likedOnly: 'false' }).success).toBe(false)
  })
  it('saves sorting but generates a new seed on each application and preserves a supplied browsing seed', () => {
    const query = artworkQuerySnapshotSchema.parse({ sortBy: 'random', randomSeed: 12 })
    expect(query).not.toHaveProperty('randomSeed')
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.2).mockReturnValueOnce(0.8)
    expect(snapshotToQuery(query).randomSeed).not.toBe(snapshotToQuery(query).randomSeed)
    expect(snapshotToQuery(query, 12).randomSeed).toBe('12')
    vi.restoreAllMocks()
  })
  it('validates dates, quotas, names and reserved setting keys', () => {
    expect(artworkQuerySnapshotSchema.safeParse({ startDate: '2026-02-30' }).success).toBe(false)
    expect(artworkQuerySnapshotSchema.safeParse({ startDate: '2026-10-14', endDate: '2026-01-01' }).success).toBe(false)
    expect(quickFilterNameSchema.parse('  我的筛选  ')).toBe('我的筛选')
    expect(quickFilterNameSchema.safeParse(' ').success).toBe(false)
    expect(updateUserSettingItemSchema.safeParse({ key: ' artwork_quick_filter:navigation ', value: [] }).success).toBe(
      false
    )
    expect(
      quickFilterSetNavigationSchema.safeParse({
        expectedUserId: '1',
        navigation: { revision: 0, ids: Array(11).fill('00000000-0000-4000-8000-000000000000') }
      }).success
    ).toBe(false)
  })
})
