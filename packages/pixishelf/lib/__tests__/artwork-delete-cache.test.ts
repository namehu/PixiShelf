import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { removeArtworkFromCache } from '../artwork-delete-cache'

describe('deleted artwork cache', () => {
  it.each(['cardList', 'viewerFeed'])(
    'keeps a returning %s round free of the deleted artwork without refetching',
    async (procedure) => {
      const client = new QueryClient()
      const key = ['artwork', procedure, 'random-v1', 'alice', { expectedUserId: 'alice' }]
      const data = {
        pages: [
          { items: [{ id: 1 }, { id: 42 }], nextRandomCursor: 'next' },
          { items: [{ id: 2 }], nextRandomCursor: 'later' }
        ],
        pageParams: [1, 'next']
      }
      client.setQueryData(key, data)
      await removeArtworkFromCache(client, 42)
      const queryFn = vi.fn(async () => data.pages[0]!)
      const returning = new InfiniteQueryObserver(client, {
        queryKey: key,
        queryFn,
        initialPageParam: 1 as number | string,
        getNextPageParam: (page) => page.nextRandomCursor,
        staleTime: Infinity,
        refetchOnMount: false
      })
      const unsubscribe = returning.subscribe(() => {})
      try {
        expect(returning.getCurrentResult().data?.pages.flatMap((page) => page.items.map((item) => item.id))).toEqual([
          1, 2
        ])
        expect(returning.getCurrentResult().data?.pageParams).toEqual([1, 'next'])
        expect(queryFn).not.toHaveBeenCalled()
      } finally {
        unsubscribe()
        client.clear()
      }
    }
  )

  it('removes the artwork across loaded feeds and nested reading shelves while preserving cursors and other detail', async () => {
    const client = new QueryClient()
    const pageParams = [1, 'frozen-cursor']
    const feed = {
      pages: [
        { items: [{ id: 1 }, { id: 42 }, { id: 2 }], nextRandomCursor: 'frozen-cursor' },
        { items: [{ id: 42 }, { id: 3 }], nextRandomCursor: 'next-cursor' }
      ],
      pageParams
    }
    const artworkKeys = [
      ['artwork', 'cardList', 'random-v1', 'alice', { expectedUserId: 'alice' }],
      ['artwork', 'viewerFeed', 'random-v1', 'bob', { expectedUserId: 'bob' }, 'navigation'],
      [['artwork', 'cardList'], { input: { expectedUserId: 'alice' }, type: 'infinite' }],
      [['artwork', 'viewerFeed'], { input: { expectedUserId: 'alice' }, type: 'infinite' }]
    ]
    const list = [['artwork', 'list'], { input: { expectedUserId: 'alice' }, type: 'query' }]
    const readingPage = {
      items: [{ artwork: { id: 1 }, reading: { progressCount: 1 } }, { artwork: { id: 42 } }],
      nextCursor: { id: 42 }
    }
    const historyKeys = [
      ['reading', 'history', 'alice'],
      [['reading', 'history'], { input: { expectedUserId: 'alice' }, type: 'infinite' }]
    ]
    const continuationKeys = [
      ['reading', 'continueReading', 'alice'],
      [['reading', 'continueReading'], { input: { expectedUserId: 'bob' }, type: 'query' }]
    ]
    const detail = [['artwork', 'getById'], { input: 42, type: 'query' }]
    const otherDetail = [['artwork', 'getById'], { input: 9, type: 'query' }]
    for (const key of artworkKeys) client.setQueryData(key, feed)
    for (const key of historyKeys) client.setQueryData(key, { pages: [readingPage], pageParams: [undefined] })
    for (const key of continuationKeys) client.setQueryData(key, readingPage)
    client.setQueryData(list, feed.pages[0])
    client.setQueryData(detail, { id: 42 })
    client.setQueryData(otherDetail, { id: 9 })
    client.setQueryData(['reading', 'context', 'alice', 9], { artworkId: 9 })

    await removeArtworkFromCache(client, 42)

    for (const key of artworkKeys) {
      expect(client.getQueryData(key)).toEqual({
        pages: [
          { ...feed.pages[0], items: [{ id: 1 }, { id: 2 }] },
          { ...feed.pages[1], items: [{ id: 3 }] }
        ],
        pageParams
      })
      expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    }
    expect(client.getQueryData(list)).toEqual({ ...feed.pages[0], items: [{ id: 1 }, { id: 2 }] })
    for (const key of historyKeys) {
      expect(client.getQueryData(key)).toEqual({
        pages: [{ ...readingPage, items: [readingPage.items[0]] }],
        pageParams: [undefined]
      })
    }
    for (const key of continuationKeys) {
      expect(client.getQueryData(key)).toEqual({ ...readingPage, items: [readingPage.items[0]] })
    }
    expect(client.getQueryData(detail)).toEqual({ id: 42 })
    expect(client.getQueryState(detail)?.isInvalidated).toBe(true)
    expect(client.getQueryData(otherDetail)).toEqual({ id: 9 })
    expect(client.getQueryState(otherDetail)?.isInvalidated).toBe(false)
    expect(client.getQueryState(['reading', 'context', 'alice', 9])?.isInvalidated).toBe(false)
    client.clear()
  })

  it('cancels a stale next page so its late response cannot restore the deleted card or restart the feed', async () => {
    const client = new QueryClient()
    const key = ['artwork', 'viewerFeed', 'random-v1', 'alice', { expectedUserId: 'alice' }]
    let resolveNext!: (value: { items: { id: number }[]; nextCursor: number | undefined }) => void
    const pending = new Promise<{ items: { id: number }[]; nextCursor: number | undefined }>((resolve) => {
      resolveNext = resolve
    })
    const queryFn = vi.fn(() => pending)
    const observer = new InfiniteQueryObserver(client, {
      queryKey: key,
      queryFn,
      initialPageParam: 1,
      initialData: {
        pages: [{ items: [{ id: 42 }, { id: 1 }], nextCursor: 2 as number | undefined }],
        pageParams: [1]
      },
      getNextPageParam: (page) => page.nextCursor,
      staleTime: Infinity,
      refetchOnMount: false
    })
    const unsubscribe = observer.subscribe(() => {})
    try {
      const loading = observer.fetchNextPage()
      await removeArtworkFromCache(client, 42)
      resolveNext({ items: [{ id: 42 }, { id: 2 }], nextCursor: undefined })
      await loading
      expect(client.getQueryData(key)).toEqual({
        pages: [{ items: [{ id: 1 }], nextCursor: 2 }],
        pageParams: [1]
      })
      expect(queryFn).toHaveBeenCalledOnce()
      expect(observer.getCurrentResult().isFetching).toBe(false)
      expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    } finally {
      unsubscribe()
      client.clear()
    }
  })

  it('does not refetch an active detail or accept an older in-flight first page', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const detailKey = [['artwork', 'getById'], { input: 42, type: 'query' }]
    const detailFetch = vi.fn(async () => {
      throw new Error('detail already deleted')
    })
    const detail = new QueryObserver(client, {
      queryKey: detailKey,
      queryFn: detailFetch,
      initialData: { id: 42 },
      staleTime: Infinity
    })
    const unsubscribeDetail = detail.subscribe(() => {})
    const key = ['artwork', 'cardList', 'random-v1', 'alice']
    let resolveFirst!: (value: { items: { id: number }[] }) => void
    const pending = new Promise<{ items: { id: number }[] }>((resolve) => {
      resolveFirst = resolve
    })
    const fetching = client.fetchQuery({ queryKey: key, queryFn: () => pending }).catch(() => undefined)
    try {
      await removeArtworkFromCache(client, 42)
      resolveFirst({ items: [{ id: 42 }] })
      await fetching
      expect(client.getQueryData(key)).toBeUndefined()
      expect(detailFetch).not.toHaveBeenCalled()
      expect(detail.getCurrentResult().data).toEqual({ id: 42 })
    } finally {
      unsubscribeDetail()
      client.clear()
    }
  })
})
