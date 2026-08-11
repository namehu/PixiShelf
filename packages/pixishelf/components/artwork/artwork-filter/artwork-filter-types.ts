import type { Option } from '@/components/shared/multiple-selector'

export type AudioFilter = 'all' | 'yes' | 'no' | 'unknown'

export interface ArtworkFilterQueryState {
  id?: number | null
  title?: string | null
  artistName?: string | null
  startDate?: string | null
  endDate?: string | null
  externalId?: string | null
  exactMatch?: boolean | null
  tags?: string | null
  excludeTags?: string | null
  mediaTypes?: string | null
  sources?: string | null
  hasAudio?: string | null
  mediaCountMin?: number | null
  mediaCountMax?: number | null
}

export interface ArtworkFilterValue {
  id: string
  title: string
  artistName: string
  startDate: string
  endDate: string
  externalId: string
  exactMatch: boolean
  tagMode: 'include' | 'exclude'
  selectedTags: Option[]
  selectedMediaTypes: Option[]
  selectedSources: Option[]
  hasAudio: AudioFilter
  mediaCountMin: number | string
  mediaCountMax: number | string
}

export interface ArtworkFilterPayload {
  id: number | null
  title: string | null
  artistName: string | null
  startDate: string | null
  endDate: string | null
  externalId: string | null
  exactMatch: boolean | null
  tags: string | null
  excludeTags: string | null
  mediaTypes: string | null
  sources: string | null
  hasAudio: AudioFilter | null
  mediaCountMin: number | null
  mediaCountMax: number | null
  page: number
}
