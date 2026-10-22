import type { QueryClient, QueryKey } from '@tanstack/react-query'

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

/** A confirmed change updates only this account's feeds and favorite collections. */
export async function refreshArtworkLikeCache(
  client: QueryClient,
  owner: string,
  artworkId: number,
  isLiked: boolean,
  canRefetch: () => boolean = () => true
) {
  const filters = {
    predicate: (query: { queryKey: QueryKey }) => {
      const parsed = artworkQuery(query.queryKey)
      return (
        parsed?.input.expectedUserId === owner && (parsed.procedure === 'viewerFeed' || parsed.input.likedOnly === true)
      )
    }
  }
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
          return likedOnly && !isLiked ? [] : [{ ...item, isLike: isLiked }]
        })
      }
    }
    client.setQueryData(query.queryKey, patch)
  }
  // Recheck after cancellation: a different session must not refetch this owner's queries.
  await client.invalidateQueries({ ...filters, refetchType: canRefetch() ? 'active' : 'none' })
}
