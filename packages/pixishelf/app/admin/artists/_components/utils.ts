import { ArtistsGetSchema } from '@/schemas/artist.dto'

export function buildArtistQuery(
  params: { pageSize: number; current: number },
  searchState: {
    name: string | null
    sortId: string | null
    sortDesc: string | null
    isStarred: string | null
  }
): ArtistsGetSchema {
  let sortBy: 'name_asc' | 'name_desc' | 'artworks_asc' | 'artworks_desc' = 'name_asc'

  if (searchState.sortId) {
    const isDesc = searchState.sortDesc === 'true'
    if (searchState.sortId === 'name') sortBy = isDesc ? 'name_desc' : 'name_asc'
    if (searchState.sortId === 'artworksCount') sortBy = isDesc ? 'artworks_desc' : 'artworks_asc'
  }

  const isStarred =
    searchState.isStarred === 'true' ? true : searchState.isStarred === 'false' ? false : undefined

  return {
    cursor: params.current,
    pageSize: params.pageSize,
    search: searchState.name || undefined,
    sortBy,
    isStarred
  }
}
