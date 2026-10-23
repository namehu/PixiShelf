import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { refreshArtworkLikeCache } from '../artwork-like-cache'
import type { ArtworkRatingLevel, ArtworkRatingState } from '@/schemas/artwork-rating.dto'
import { artworkRatingQueryKey } from '../artwork-rating-state'

const rating = (artworkId: number, level: ArtworkRatingLevel): ArtworkRatingState => ({
  artworkId, level, isLike: level !== null && level >= 2, updatedAt: level === null ? null : '2026-10-22T12:00:00.000Z'
})

describe('favorite query membership', () => {
  it('keeps next-page loading and reapplies the latest rating without removing a favorite', async () => {
    const client = new QueryClient()
    const key = ['artwork', 'viewerFeed', 'random-v1', 'alice', { likedOnly: true, expectedUserId: 'alice' }]
    const firstPage = { items: [{ id: 1, ratingLevel: 2, isLike: true }], nextCursor: 2 as number | undefined }
    const nextPage = { items: [{ id: 2, ratingLevel: 2, isLike: true }], nextCursor: undefined }
    let resolveNext!: (page: typeof firstPage) => void
    const pending = new Promise<typeof firstPage>((resolve) => { resolveNext = resolve })
    const fetch = vi.fn(() => pending)
    const observer = new InfiniteQueryObserver(client, {
      queryKey: key, queryFn: fetch, initialPageParam: 1,
      initialData: { pages: [firstPage], pageParams: [1] },
      getNextPageParam: (page) => page.nextCursor,
      staleTime: Infinity
    })
    const unsubscribe = observer.subscribe(() => {})
    try {
      const loading = observer.fetchNextPage()
      await refreshArtworkLikeCache(client, 'alice', rating(1, 4))
      await refreshArtworkLikeCache(client, 'alice', rating(1, null))
      expect(observer.getCurrentResult().isFetchingNextPage).toBe(true)
      resolveNext(nextPage)
      await loading
      expect(fetch).toHaveBeenCalledOnce()
      expect(client.getQueryData(key)).toMatchObject({
        pages: [{ items: [{ id: 1, ratingLevel: null, isLike: false }] }, nextPage], pageParams: [1, 2]
      })
    } finally { resolveNext(nextPage); unsubscribe(); client.clear() }
  })

  it('keeps an in-flight first page and applies the confirmed rating when it arrives', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const key = ['artwork', 'cardList', 'random-v1', 'alice', { expectedUserId: 'alice' }]
    let resolveFirst!: (value: unknown) => void
    const first = new Promise<unknown>((resolve) => { resolveFirst = resolve })
    const page = { pages: [{ items: [{ id: 1 }, { id: 2 }] }], pageParams: [1] }
    const fetch = vi.fn().mockImplementationOnce(() => first).mockResolvedValue(page)
    const observer = new QueryObserver(client, { queryKey: key, queryFn: fetch })
    const unsubscribe = observer.subscribe(() => {})
    try {
      expect(fetch).toHaveBeenCalledOnce()
      await refreshArtworkLikeCache(client, 'alice', rating(1, 3))
      expect(fetch).toHaveBeenCalledOnce()
      resolveFirst(page)
      await vi.waitFor(() => expect(client.getQueryData(key)).toMatchObject({
        pages: [{ items: [{ id: 1, ratingLevel: 3, isLike: true }, { id: 2 }] }], pageParams: [1]
      }))
    } finally {
      resolveFirst(page)
      unsubscribe()
      client.clear()
    }
  })

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
    currentOwner = 'bob'
    await refreshArtworkLikeCache(client, 'alice', rating(1, null))
    expect(fetch).not.toHaveBeenCalled()
    expect(client.getQueryState(alice)?.isInvalidated).toBe(true)
    expect(client.getQueryData(alice)).toMatchObject({ pages: [{ items: [{ id: 1, isLike: false }, { id: 2 }] }] })
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
  it('updates ratings in place without removing favorites, moving items or touching another account', async () => {
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
    await refreshArtworkLikeCache(client, 'alice', rating(1, 1))
    expect(cancel).not.toHaveBeenCalled()
    expect(client.getQueryData(favorites)).toMatchObject({ pages: [{ items: [{ id: 1, isLike: false }, { id: 2 }], nextReadingCursor: 'same' }] })
    expect(client.getQueryData(trpc)).toMatchObject({ items: [{ id: 1, isLike: false }, { id: 2 }] })
    expect(client.getQueryData(feed)).toMatchObject({
      pages: [
        {
          items: [
            { id: 1, isLike: false, ratingLevel: 1 },
            { id: 2, isLike: true }
          ]
        }
      ]
    })
    expect(client.getQueryData(other)).toBe(data)
    expect(client.getQueryState(other)?.isInvalidated).toBe(false)
    expect(client.getQueryState(all)?.isInvalidated).toBe(true)
    expect(client.getQueryData(all)).toMatchObject({ pages: [{ items: [{ id: 1, ratingLevel: 1, isLike: false }, { id: 2 }] }] })
    expect(client.getQueryData(artworkRatingQueryKey('alice', 1))).toEqual(rating(1, 1))
    expect(client.getQueryState(favorites)?.isInvalidated).toBe(true)
    expect(client.getQueryState(feed)?.isInvalidated).toBe(true)
    client.clear()
  })

  it.each(['cardList', 'viewerFeed'])('does not reload an active %s after liking a now-read video', async (procedure) => {
    const client = new QueryClient()
    const key = ['artwork', procedure, 'random-v1', 'alice', { readingStatus: 'UNREAD', expectedUserId: 'alice' }]
    const video = { id: 1, key: '1', images: [{ id: 11, key: '11', mediaType: 'VIDEO' }], ratingLevel: null, isLike: false }
    client.setQueryData(key, { pages: [{ items: [video], nextReadingCursor: 'next' }], pageParams: [1] })
    const fetch = vi.fn().mockResolvedValue({ pages: [{ items: [] }], pageParams: [1] })
    const observer = new QueryObserver(client, { queryKey: key, queryFn: fetch, staleTime: Infinity })
    const unsubscribe = observer.subscribe(() => {})
    try {
      await refreshArtworkLikeCache(client, 'alice', rating(1, 2))
      expect(fetch).not.toHaveBeenCalled()
      expect(client.getQueryData(key)).toMatchObject({
        pages: [{ items: [{ ...video, ratingLevel: 2, isLike: true }], nextReadingCursor: 'next' }], pageParams: [1]
      })
    } finally { unsubscribe(); client.clear() }
  })

  it('invalidates favorite lists after adding a like without inventing a position in the sorted collection', async () => {
    const client = new QueryClient()
    const key = ['artwork', 'cardList', 'random-v1', 'alice', { likedOnly: true, expectedUserId: 'alice' }]
    client.setQueryData(key, { pages: [{ items: [] }], pageParams: [1] })
    await refreshArtworkLikeCache(client, 'alice', rating(9, 4))
    expect(client.getQueryData(key)).toMatchObject({ pages: [{ items: [] }] })
    expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    client.clear()
  })
})
