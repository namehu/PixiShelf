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
  rating: ArtworkRatingState,
  canRefetch: () => boolean = () => true
) {
  const { artworkId, level, isLike } = rating
  const filters = {
    predicate: (query: { queryKey: QueryKey }) => {
      const parsed = artworkQuery(query.queryKey)
      return parsed?.input.expectedUserId === owner
    }
  }
  // Ordinary lists do not need a fresh page for a rating change, but canceling
  // their initial/page request must not leave an active list without a result.
  const interrupted = new Set(client.getQueryCache().findAll(filters)
    .filter((query) => query.state.fetchStatus === 'fetching')
    .map((query) => query.queryHash))
  await client.cancelQueries(filters)
  for (const query of client.getQueryCache().findAll(filters)) {
    const likedOnly = artworkQuery(query.queryKey)?.input.likedOnly === true
    const patch = (value: unknown): unknown => {
      if (!record(value)) return value
      if (Array.isArray(value.pages)) return { ...value, pages: value.pages.map(patch) }
      if (!Array.isArray(value.items)) return value
      return {
        ...value,
        items: value.items.flatMap((item: unknown) => {
          if (!record(item) || item.id !== artworkId) return [item]
          return likedOnly && !isLike ? [] : [{ ...item, ratingLevel: level, isLike }]
        })
      }
    }
    client.setQueryData(query.queryKey, patch)
  }
  client.setQueryData(artworkRatingQueryKey(owner, artworkId), rating)
  // Recheck after cancellation: a different session must not refetch this owner's queries.
  // Feed refetches can be slow; they must not hold the shared write queue open.
  void client.invalidateQueries({
    predicate: (query) => {
      const parsed = artworkQuery(query.queryKey)
      return parsed?.input.expectedUserId === owner &&
        (parsed.procedure === 'viewerFeed' || parsed.input.likedOnly === true || interrupted.has(query.queryHash))
    },
    refetchType: canRefetch() ? 'active' : 'none'
  }).catch(() => {})
}
