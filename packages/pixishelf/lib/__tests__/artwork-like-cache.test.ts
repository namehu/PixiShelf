import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { refreshArtworkLikeCache } from '../artwork-like-cache'

describe('favorite query membership', () => {
  it('expires the initiating account cache across a session switch and refetches only when that account returns', async () => {
    const client = new QueryClient()
    const alice = ['artwork', 'viewerFeed', 'random-v1', 'alice', { likedOnly: true, expectedUserId: 'alice' }]
    const bob = ['artwork', 'viewerFeed', 'random-v1', 'bob', { likedOnly: true, expectedUserId: 'bob' }]
    const original = {
      pages: [
        {
          items: [
            { id: 1, isLike: true },
            { id: 2, isLike: true }
          ]
        }
      ],
      pageParams: [1]
    }
    client.setQueryData(alice, original)
    client.setQueryData(bob, original)
    let currentOwner = 'alice'
    const fetch = vi.fn(async () => {
      expect(currentOwner).toBe('alice')
      return { pages: [{ items: [{ id: 2, isLike: true }] }], pageParams: [1] }
    })
    const options = { queryKey: alice, queryFn: fetch, staleTime: 10 * 60 * 1000 }
    const observer = new QueryObserver(client, options)
    const unsubscribe = observer.subscribe(() => {})
    const cancel = client.cancelQueries.bind(client)
    vi.spyOn(client, 'cancelQueries').mockImplementationOnce(async (filters) => {
      await cancel(filters)
      currentOwner = 'bob'
    })
    await refreshArtworkLikeCache(client, 'alice', 1, false, () => currentOwner === 'alice')
    expect(fetch).not.toHaveBeenCalled()
    expect(client.getQueryState(alice)?.isInvalidated).toBe(true)
    expect(client.getQueryData(alice)).toMatchObject({ pages: [{ items: [{ id: 2 }] }] })
    expect(client.getQueryState(bob)?.isInvalidated).toBe(false)
    expect(client.getQueryData(bob)).toBe(original)
    unsubscribe()
    currentOwner = 'alice'
    const returning = new QueryObserver(client, options)
    const unsubscribeReturning = returning.subscribe(() => {})
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    unsubscribeReturning()
    client.clear()
  })
  it('removes unliked artwork from the owner collection and refreshes their feeds without touching another account', async () => {
    const client = new QueryClient()
    const favorites = ['artwork', 'cardList', 'random-v1', 'alice', { likedOnly: true, expectedUserId: 'alice' }]
    const other = ['artwork', 'cardList', 'random-v1', 'bob', { likedOnly: true, expectedUserId: 'bob' }]
    const all = ['artwork', 'cardList', 'random-v1', 'alice', { expectedUserId: 'alice' }]
    const feed = ['artwork', 'viewerFeed', 'random-v1', 'alice', { expectedUserId: 'alice' }]
    const trpc = [['artwork', 'list'], { input: { likedOnly: true, expectedUserId: 'alice' }, type: 'query' }]
    const data = {
      pages: [
        {
          items: [
            { id: 1, isLike: true },
            { id: 2, isLike: true }
          ],
          nextReadingCursor: 'same'
        }
      ],
      pageParams: [1]
    }
    for (const key of [favorites, other, all, feed]) client.setQueryData(key, data)
    client.setQueryData(trpc, data.pages[0])
    const cancel = vi.spyOn(client, 'cancelQueries')
    await refreshArtworkLikeCache(client, 'alice', 1, false)
    expect(cancel).toHaveBeenCalledOnce()
    expect(client.getQueryData(favorites)).toMatchObject({ pages: [{ items: [{ id: 2 }], nextReadingCursor: 'same' }] })
    expect(client.getQueryData(trpc)).toMatchObject({ items: [{ id: 2 }] })
    expect(client.getQueryData(feed)).toMatchObject({
      pages: [
        {
          items: [
            { id: 1, isLike: false },
            { id: 2, isLike: true }
          ]
        }
      ]
    })
    expect(client.getQueryData(other)).toBe(data)
    expect(client.getQueryState(other)?.isInvalidated).toBe(false)
    expect(client.getQueryState(all)?.isInvalidated).toBe(false)
    expect(client.getQueryState(favorites)?.isInvalidated).toBe(true)
    expect(client.getQueryState(feed)?.isInvalidated).toBe(true)
    client.clear()
  })

  it('invalidates favorite lists after adding a like without inventing a position in the sorted collection', async () => {
    const client = new QueryClient()
    const key = ['artwork', 'cardList', 'random-v1', 'alice', { likedOnly: true, expectedUserId: 'alice' }]
    client.setQueryData(key, { pages: [{ items: [] }], pageParams: [1] })
    await refreshArtworkLikeCache(client, 'alice', 9, true)
    expect(client.getQueryData(key)).toMatchObject({ pages: [{ items: [] }] })
    expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    client.clear()
  })
})
