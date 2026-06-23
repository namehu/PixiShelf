import { describe, expect, test } from 'vitest'
import {
  buildArtworkSearchPayload,
  buildMigrationFilters,
  buildInitialLocalSearch,
  normalizeAudioFilter,
  restoreMediaTypeOptions,
  restoreSourceOptions
} from '../artwork-management-utils'

describe('artwork management utils', () => {
  test('normalizes audio filter values and falls back to all', () => {
    expect(normalizeAudioFilter('yes')).toBe('yes')
    expect(normalizeAudioFilter('no')).toBe('no')
    expect(normalizeAudioFilter('unknown')).toBe('unknown')
    expect(normalizeAudioFilter('bad')).toBe('all')
    expect(normalizeAudioFilter(null)).toBe('all')
  })

  test('restores media type options from comma separated URL value', () => {
    const options = restoreMediaTypeOptions('jpg,.mp4,unknown')

    expect(options.map((option) => option.value)).toEqual(['.jpg', '.mp4'])
    expect(options.map((option) => option.category)).toEqual(['图片', '视频'])
  })

  test('restores source options from comma separated URL value', () => {
    const options = restoreSourceOptions('PIXIV_IMPORTED,LOCAL_CREATED')

    expect(options.map((option) => option.value)).toEqual(['PIXIV_IMPORTED', 'LOCAL_CREATED'])
  })

  test('builds initial local search state from URL state with exclude tags preferred for display', () => {
    const localSearch = buildInitialLocalSearch({
      id: 12,
      title: 'title',
      artistName: 'artist',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      externalId: '123456',
      exactMatch: true,
      tags: 'include-a',
      excludeTags: 'exclude-a,exclude-b',
      mediaTypes: 'jpg',
      sources: 'PIXIV_IMPORTED',
      hasAudio: 'bad',
      mediaCountMin: 2,
      mediaCountMax: 8
    })

    expect(localSearch).toMatchObject({
      id: '12',
      title: 'title',
      artistName: 'artist',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      externalId: '123456',
      exactMatch: true,
      tagMode: 'exclude',
      hasAudio: 'all',
      mediaCountMin: 2,
      mediaCountMax: 8
    })
    expect(localSearch.selectedTags.map((tag) => tag.value)).toEqual(['exclude-a', 'exclude-b'])
    expect(localSearch.selectedMediaTypes.map((item) => item.value)).toEqual(['.jpg'])
    expect(localSearch.selectedSources.map((item) => item.value)).toEqual(['PIXIV_IMPORTED'])
  })

  test('builds URL search payload and clears mutually exclusive tag mode', () => {
    const payload = buildArtworkSearchPayload({
      id: '15',
      title: '',
      artistName: 'artist',
      startDate: '',
      endDate: '2026-02-01',
      externalId: '987',
      exactMatch: false,
      tagMode: 'exclude',
      selectedTags: [
        { label: 'a', value: 'a' },
        { label: 'b', value: 'b' }
      ],
      selectedMediaTypes: [{ label: 'JPG', value: '.jpg', category: '图片' }],
      selectedSources: [{ label: 'Pixiv 导入', value: 'PIXIV_IMPORTED' }],
      hasAudio: 'all',
      mediaCountMin: '',
      mediaCountMax: 10
    })

    expect(payload).toEqual({
      id: 15,
      title: null,
      artistName: 'artist',
      startDate: null,
      endDate: '2026-02-01',
      externalId: '987',
      exactMatch: null,
      tags: null,
      excludeTags: 'a,b',
      mediaTypes: '.jpg',
      sources: 'PIXIV_IMPORTED',
      hasAudio: null,
      mediaCountMin: null,
      mediaCountMax: 10,
      page: 1
    })
  })

  test('builds migration filters from URL search state', () => {
    expect(
      buildMigrationFilters({
        id: 1,
        title: 'title',
        artistName: 'artist',
        startDate: '2026-01-01',
        endDate: null,
        externalId: '',
        mediaTypes: '.jpg',
        exactMatch: true
      })
    ).toEqual({
      id: 1,
      search: 'title',
      artistName: 'artist',
      startDate: '2026-01-01',
      endDate: null,
      externalId: null,
      mediaTypes: '.jpg',
      exactMatch: true
    })
  })
})
