import { describe, expect, it } from 'vitest'
import {
  deferDiscoveryItemsSchema,
  deferredItemsCommandSchema,
  downloadDeferredItemsSchema,
  listDeferredItemsSchema
} from '../discovery-deferred-service'

describe('deferred discovery input boundary', () => {
  it('bounds batches, forbids client destinations, and keeps download defaults explicit', () => {
    expect(
      deferDiscoveryItemsSchema.safeParse({
        sourceId: 'one',
        itemIds: Array.from({ length: 101 }, (_, index) => `item-${index}`),
        requestId: 'one'
      }).success
    ).toBe(false)
    expect(deferredItemsCommandSchema.safeParse({ deferredItemIds: [], requestId: 'one' }).success).toBe(false)
    expect(
      downloadDeferredItemsSchema.safeParse({
        deferredItemIds: ['one'],
        requestId: 'one',
        canonicalUrl: 'https://evil.test/'
      }).success
    ).toBe(false)
    expect(downloadDeferredItemsSchema.parse({ deferredItemIds: ['one', 'one'], requestId: 'one' })).toEqual({
      deferredItemIds: ['one'],
      requestId: 'one',
      downloadMode: 'AUTO',
      quality: 'ORIGINAL',
      downloadScope: 'ALL'
    })
    expect(listDeferredItemsSchema.safeParse({ limit: 101 }).success).toBe(false)
  })
})
