export type {
  ArtworkFilterQueryState as ArtworkManagementSearchState,
  ArtworkFilterValue as LocalArtworkSearchState,
  ArtworkFilterPayload as ArtworkSearchPayload,
  AudioFilter
} from '@/components/artwork/artwork-filter'

export interface MigrationFilters {
  id: number | null
  search: string | null
  artistName: string | null
  startDate: string | null
  endDate: string | null
  externalId: string | null
  mediaTypes: string | null
  exactMatch: boolean
}

export interface MigrationSafety {
  transferMode: 'move' | 'copy'
  verifyAfterCopy: boolean
  cleanupSource: boolean
}
