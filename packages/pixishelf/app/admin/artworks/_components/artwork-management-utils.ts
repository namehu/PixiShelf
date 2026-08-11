import type { ArtworkManagementSearchState, MigrationFilters } from './artwork-management-types'

export {
  buildArtworkFilterPayload as buildArtworkSearchPayload,
  buildEmptyArtworkFilter as buildEmptyLocalSearch,
  buildInitialArtworkFilter as buildInitialLocalSearch,
  MEDIA_TYPE_OPTIONS,
  normalizeAudioFilter,
  restoreMediaTypeOptions,
  restoreSourceOptions
} from '@/components/artwork/artwork-filter'

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
