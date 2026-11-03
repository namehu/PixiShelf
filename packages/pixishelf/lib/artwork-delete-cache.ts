import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'

type ArtworkPage = { items: { id: number }[] }
type ReadingPage = { items: { artwork: { id: number } }[] }
type Collection = 'artwork' | 'reading' | 'detail'

function deletionCollection(key: QueryKey, artworkId: number): Collection | null {
  const [namespace, operation] = key
  if (namespace === 'artwork' && (operation === 'cardList' || operation === 'viewerFeed')) return 'artwork'
  if (namespace === 'reading' && (operation === 'history' || operation === 'continueReading')) return 'reading'
  if (!Array.isArray(namespace)) return null
  const [router, procedure] = namespace
  if (router === 'artwork' && ['list', 'cardList', 'viewerFeed'].includes(procedure)) return 'artwork'
  if (router === 'reading' && ['history', 'continueReading'].includes(procedure)) return 'reading'
  if (
    router === 'artwork' &&
    procedure === 'getById' &&
    operation !== null &&
    typeof operation === 'object' &&
    'input' in operation &&
    operation.input === artworkId
  ) {
    return 'detail'
  }
  return null
}

/** Remove a globally deleted artwork without restarting any account's browsing round. */
export async function removeArtworkFromCache(client: QueryClient, artworkId: number) {
  const filters = {
    predicate: (query: { queryKey: QueryKey }) => deletionCollection(query.queryKey, artworkId) !== null
  }
  // Cancellation prevents an older first/next page from restoring the removed card.
  await client.cancelQueries(filters)
  for (const query of client.getQueryCache().findAll(filters)) {
    const collection = deletionCollection(query.queryKey, artworkId)
    if (collection === 'detail') continue
    if (collection === 'artwork') {
      client.setQueryData<ArtworkPage | InfiniteData<ArtworkPage>>(query.queryKey, (data) => {
        if (!data) return data
        const remove = (page: ArtworkPage) => ({ ...page, items: page.items.filter((item) => item.id !== artworkId) })
        return 'pages' in data ? { ...data, pages: data.pages.map(remove) } : remove(data)
      })
    } else {
      client.setQueryData<ReadingPage | InfiniteData<ReadingPage>>(query.queryKey, (data) => {
        if (!data) return data
        const remove = (page: ReadingPage) => ({
          ...page,
          items: page.items.filter((item) => item.artwork.id !== artworkId)
        })
        return 'pages' in data ? { ...data, pages: data.pages.map(remove) } : remove(data)
      })
    }
  }
  await client.invalidateQueries({ ...filters, refetchType: 'none' })
}
