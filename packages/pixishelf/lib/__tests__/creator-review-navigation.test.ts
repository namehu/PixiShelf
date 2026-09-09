import { describe, expect, it } from 'vitest'
import { creatorReviewHref, readCreatorReviewSelection } from '../creator-review-navigation'

describe('creator review selection transfer', () => {
  it('keeps a large selection across a page reload without putting all IDs in the URL', () => {
    const values = new Map<string, string>()
    const storage = {
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
      getItem: (key: string) => values.get(key) ?? null
    }
    const ids = Array.from({ length: 10000 }, (_, index) => index + 1)
    const url = new URL(creatorReviewHref(ids, storage), 'http://localhost')
    expect(url.href.length).toBeLessThan(150)
    expect(readCreatorReviewSelection(url.searchParams.get('selection')!, storage)).toEqual(ids)
  })
  it('rejects missing, corrupt or empty selections instead of expanding to all works', () => {
    for (const value of [null, 'invalid', '[]', '[0]', '["12"]', '[null]']) {
      expect(() => readCreatorReviewSelection('missing', { getItem: () => value })).toThrow()
    }
  })
})
