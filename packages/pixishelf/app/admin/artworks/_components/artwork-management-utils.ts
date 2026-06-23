import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '@/lib/constant'
import { OSource } from '@/enums/ESource'
import type {
  ArtworkManagementSearchState,
  ArtworkSearchPayload,
  AudioFilter,
  LocalArtworkSearchState,
  MigrationFilters
} from './artwork-management-types'
import type { Option } from '@/components/shared/multiple-selector'

export const MEDIA_TYPE_OPTIONS: Option[] = [
  ...IMAGE_EXTENSIONS.map((ext) => ({
    label: ext.replace('.', '').toUpperCase(),
    value: ext,
    category: '图片'
  })),
  ...VIDEO_EXTENSIONS.map((ext) => ({
    label: ext.replace('.', '').toUpperCase(),
    value: ext,
    category: '视频'
  }))
]

export function normalizeAudioFilter(value?: string | null): AudioFilter {
  return value === 'yes' || value === 'no' || value === 'unknown' ? value : 'all'
}

export function restoreMediaTypeOptions(value?: string | null): Option[] {
  if (!value) return []

  const selected = new Set(
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .map((item) => (item.startsWith('.') ? item : `.${item}`))
  )

  return MEDIA_TYPE_OPTIONS.filter((option) => selected.has(option.value))
}

export function restoreSourceOptions(value?: string | null): Option[] {
  if (!value) return []
  const selected = new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  )
  return OSource.filter((option) => selected.has(option.value))
}

export function buildInitialLocalSearch(searchState: ArtworkManagementSearchState): LocalArtworkSearchState {
  return {
    id: searchState.id?.toString() || '',
    title: searchState.title || '',
    artistName: searchState.artistName || '',
    startDate: searchState.startDate || '',
    endDate: searchState.endDate || '',
    externalId: searchState.externalId || '',
    exactMatch: searchState.exactMatch || false,
    tagMode: searchState.excludeTags ? 'exclude' : 'include',
    selectedTags: (searchState.excludeTags || searchState.tags || '')
      .split(',')
      .filter(Boolean)
      .map((tag) => ({ label: tag, value: tag })) as Option[],
    selectedMediaTypes: restoreMediaTypeOptions(searchState.mediaTypes),
    selectedSources: restoreSourceOptions(searchState.sources),
    hasAudio: normalizeAudioFilter(searchState.hasAudio),
    mediaCountMin: searchState.mediaCountMin ?? '',
    mediaCountMax: searchState.mediaCountMax ?? ''
  }
}

export function buildArtworkSearchPayload(localSearch: LocalArtworkSearchState): ArtworkSearchPayload {
  const parsedArtworkId = Number(localSearch.id)
  const artworkId = Number.isInteger(parsedArtworkId) && parsedArtworkId > 0 ? parsedArtworkId : null
  const tagsStr = localSearch.selectedTags.length > 0 ? localSearch.selectedTags.map((t) => t.value).join(',') : null
  const mediaTypesStr =
    localSearch.selectedMediaTypes.length > 0
      ? localSearch.selectedMediaTypes.map((item) => item.value).join(',')
      : null
  const sourcesStr =
    localSearch.selectedSources.length > 0 ? localSearch.selectedSources.map((item) => item.value).join(',') : null

  return {
    id: artworkId,
    title: localSearch.title || null,
    artistName: localSearch.artistName || null,
    startDate: localSearch.startDate || null,
    endDate: localSearch.endDate || null,
    externalId: localSearch.externalId || null,
    exactMatch: localSearch.exactMatch || null,
    tags: localSearch.tagMode === 'include' ? tagsStr : null,
    excludeTags: localSearch.tagMode === 'exclude' ? tagsStr : null,
    mediaTypes: mediaTypesStr,
    sources: sourcesStr,
    hasAudio: localSearch.hasAudio === 'all' ? null : localSearch.hasAudio,
    mediaCountMin: localSearch.mediaCountMin === '' ? null : Number(localSearch.mediaCountMin),
    mediaCountMax: localSearch.mediaCountMax === '' ? null : Number(localSearch.mediaCountMax),
    page: 1
  }
}

export function buildEmptyLocalSearch(): LocalArtworkSearchState {
  return {
    id: '',
    title: '',
    artistName: '',
    startDate: '',
    endDate: '',
    externalId: '',
    exactMatch: false,
    tagMode: 'include',
    selectedTags: [],
    selectedMediaTypes: [],
    selectedSources: [],
    hasAudio: 'all',
    mediaCountMin: '',
    mediaCountMax: ''
  }
}

export function buildMigrationFilters(searchState: ArtworkManagementSearchState): MigrationFilters {
  return {
    id: searchState.id || null,
    search: searchState.title || null,
    artistName: searchState.artistName || null,
    startDate: searchState.startDate || null,
    endDate: searchState.endDate || null,
    externalId: searchState.externalId || null,
    mediaTypes: searchState.mediaTypes || null,
    exactMatch: searchState.exactMatch || false
  }
}
