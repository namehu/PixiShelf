import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '@/lib/constant'
import { OSource } from '@/enums/e-source'
import type { Option } from '@/components/shared/multiple-selector'
import type {
  ArtworkFilterPayload,
  ArtworkFilterQueryState,
  ArtworkFilterValue,
  AudioFilter
} from './artwork-filter-types'

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
  const selected = new Set(value.split(',').map((item) => item.trim()).filter(Boolean))
  return OSource.filter((option) => selected.has(option.value))
}

export function buildInitialArtworkFilter(query: ArtworkFilterQueryState = {}): ArtworkFilterValue {
  return {
    id: query.id?.toString() || '',
    title: query.title || '',
    artistName: query.artistName || '',
    startDate: query.startDate || '',
    endDate: query.endDate || '',
    externalId: query.externalId || '',
    exactMatch: query.exactMatch || false,
    tagMode: query.excludeTags ? 'exclude' : 'include',
    selectedTags: (query.excludeTags || query.tags || '')
      .split(',')
      .filter(Boolean)
      .map((tag) => ({ label: tag, value: tag })) as Option[],
    selectedMediaTypes: restoreMediaTypeOptions(query.mediaTypes),
    selectedSources: restoreSourceOptions(query.sources),
    hasAudio: normalizeAudioFilter(query.hasAudio),
    mediaCountMin: query.mediaCountMin ?? '',
    mediaCountMax: query.mediaCountMax ?? ''
  }
}

export function buildArtworkFilterPayload(value: ArtworkFilterValue): ArtworkFilterPayload {
  const parsedArtworkId = Number(value.id)
  const artworkId = Number.isInteger(parsedArtworkId) && parsedArtworkId > 0 ? parsedArtworkId : null
  const tags = value.selectedTags.length > 0 ? value.selectedTags.map((item) => item.value).join(',') : null
  const mediaTypes =
    value.selectedMediaTypes.length > 0
      ? value.selectedMediaTypes.map((item) => item.value).join(',')
      : null
  const sources =
    value.selectedSources.length > 0 ? value.selectedSources.map((item) => item.value).join(',') : null

  return {
    id: artworkId,
    title: value.title || null,
    artistName: value.artistName || null,
    startDate: value.startDate || null,
    endDate: value.endDate || null,
    externalId: value.externalId || null,
    exactMatch: value.exactMatch || null,
    tags: value.tagMode === 'include' ? tags : null,
    excludeTags: value.tagMode === 'exclude' ? tags : null,
    mediaTypes,
    sources,
    hasAudio: value.hasAudio === 'all' ? null : value.hasAudio,
    mediaCountMin: value.mediaCountMin === '' ? null : Number(value.mediaCountMin),
    mediaCountMax: value.mediaCountMax === '' ? null : Number(value.mediaCountMax),
    page: 1
  }
}

export function buildEmptyArtworkFilter(): ArtworkFilterValue {
  return buildInitialArtworkFilter()
}
