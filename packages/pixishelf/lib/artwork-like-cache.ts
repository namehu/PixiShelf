import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { ArtworkRatingState } from '@/schemas/artwork-rating.dto'
import { artworkRatingQueryKey } from '@/lib/artwork-rating-state'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function artworkQuery(key: QueryKey) {
  const [namespace, operation] = key
  if (namespace === 'artwork' && (operation === 'cardList' || operation === 'viewerFeed')) {
    const input = key.find((part) => record(part) && 'expectedUserId' in part)
    return record(input) ? { procedure: operation, input } : null
  }
  if (
    Array.isArray(namespace) &&
    namespace[0] === 'artwork' &&
    ['list', 'cardList', 'viewerFeed'].includes(namespace[1]) &&
    record(operation) &&
    record(operation.input)
  ) {
    return { procedure: namespace[1], input: operation.input }
  }
  return null
}

/** A confirmed rating updates only this account's feeds and favorite collections. */
export async function refreshArtworkLikeCache(
  client: QueryClient,
  owner: string,
  rating: ArtworkRatingState
) {
  const { artworkId } = rating
  const filters = {
    predicate: (query: { queryKey: QueryKey }) => {
      const parsed = artworkQuery(query.queryKey)
      return parsed?.input.expectedUserId === owner
    }
  }
  client.setQueryData(artworkRatingQueryKey(owner, artworkId), rating)
  for (const query of client.getQueryCache().findAll(filters)) {
    const patch = (value: unknown, latest: ArtworkRatingState): unknown => {
      if (!record(value)) return value
      if (Array.isArray(value.pages)) return { ...value, pages: value.pages.map((page) => patch(page, latest)) }
      if (!Array.isArray(value.items)) return value
      return {
        ...value,
        items: value.items.map((item: unknown) => {
          if (!record(item) || item.id !== artworkId) return item
          return { ...item, ratingLevel: latest.level, isLike: latest.isLike }
        })
      }
    }
    const applyRating = () => {
      const latest = client.getQueryData<ArtworkRatingState>(artworkRatingQueryKey(owner, artworkId)) ?? rating
      client.setQueryData(query.queryKey, (value: unknown) => patch(value, latest))
    }
    // Let an initial/next page finish. Its older rating must not undo a later
    // confirmation, and restarting the feed would re-filter already loaded items.
    if (query.state.fetchStatus !== 'idle') {
      const unsubscribe = client.getQueryCache().subscribe((event) => {
        if (event.query !== query) return
        if (event.type === 'removed') { unsubscribe(); return }
        if (event.type !== 'updated' || query.state.fetchStatus !== 'idle') return
        unsubscribe()
        applyRating()
        void client.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: 'none' })
      })
    }
    applyRating()
  }
  // Membership and order belong to this browsing round, including favorites.
  // Apply fresh filter results only on an explicit refresh or a later visit.
  void client.invalidateQueries({ ...filters, refetchType: 'none' }).catch(() => {})
}
