import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { ReadingSummaryDto } from '@pixishelf/db/reading-contract'
import { patchReadingSummaryInCache } from '../reading-cache'

const unread: ReadingSummaryDto = {
  artworkId: 7, viewCount: 0, seenCount: 0, totalCount: 3, status: 'UNREAD',
  lastViewedAt: null, lastActiveAt: null, lastMediaId: null, lastMediaIndex: null
}
const viewed: ReadingSummaryDto = {
  ...unread, viewCount: 1, seenCount: 1, status: 'IN_PROGRESS',
  lastViewedAt: '2026-09-24T00:00:00.000Z', lastActiveAt: '2026-09-24T00:00:00.000Z',
  lastMediaId: 10, lastMediaIndex: 0
}

describe('reading cache patch', () => {
  it('updates only the current account without removing or reordering loaded unread rows', () => {
    const client = new QueryClient()
    const aliceKey = ['artwork', 'cardList', 'alice', { expectedUserId: 'alice', readingStatus: 'UNREAD' }]
    const bobKey = ['artwork', 'cardList', 'bob', { expectedUserId: 'bob', readingStatus: 'UNREAD' }]
    const page = {
      pages: [{ items: [
        { artworkId: 7, reading: unread },
        { artworkId: 8, reading: { ...unread, artworkId: 8 } }
      ], nextReadingCursor: 'next' }],
      pageParams: [null]
    }
    client.setQueryData(aliceKey, page)
    client.setQueryData(bobKey, page)
    patchReadingSummaryInCache(client, viewed, 'alice')
    const alice = client.getQueryData<typeof page>(aliceKey)
    const bob = client.getQueryData<typeof page>(bobKey)
    expect(alice?.pages[0]?.items.map((item) => item.artworkId)).toEqual([7, 8])
    expect(alice?.pages[0]?.nextReadingCursor).toBe('next')
    expect(alice?.pages[0]?.items[0]?.reading).toEqual(viewed)
    expect(bob?.pages[0]?.items[0]?.reading).toEqual(unread)
  })

  it('matches overlapping account IDs exactly in custom and tRPC keys', () => {
    const client = new QueryClient()
    const customOwnerKey = ['reading', 'history', 'user-1']
    const customOtherKey = ['reading', 'history', 'user-10']
    const summariesOwnerKey = ['reading', 'summaries', 'user-1', '7']
    const summariesOtherKey = ['reading', 'summaries', 'user-10', '7']
    const trpcOwnerKey = [['reading', 'context'], { input: { artworkId: 7, expectedUserId: 'user-1' }, type: 'query' }]
    const trpcOtherKey = [['reading', 'context'], { input: { artworkId: 7, expectedUserId: 'user-10' }, type: 'query' }]
    const artworkOwnerKey = [['artwork', 'list'], { input: { expectedUserId: 'user-1' }, type: 'query' }]
    const artworkOtherKey = [['artwork', 'list'], { input: { expectedUserId: 'user-10' }, type: 'query' }]
    for (const key of [customOwnerKey, customOtherKey, trpcOwnerKey, trpcOtherKey, artworkOwnerKey, artworkOtherKey]) {
      client.setQueryData(key, { items: [{ artworkId: 7, reading: unread }], summary: unread })
    }
    for (const key of [summariesOwnerKey, summariesOtherKey]) client.setQueryData(key, [unread])

    patchReadingSummaryInCache(client, viewed, 'user-1')

    for (const key of [customOwnerKey, trpcOwnerKey, artworkOwnerKey]) {
      expect(client.getQueryData<{ summary: ReadingSummaryDto }>(key)?.summary).toEqual(viewed)
    }
    for (const key of [customOtherKey, trpcOtherKey, artworkOtherKey]) {
      expect(client.getQueryData<{ summary: ReadingSummaryDto }>(key)?.summary).toEqual(unread)
    }
    expect(client.getQueryData<ReadingSummaryDto[]>(summariesOwnerKey)).toEqual([viewed])
    expect(client.getQueryData<ReadingSummaryDto[]>(summariesOtherKey)).toEqual([unread])
  })
})
