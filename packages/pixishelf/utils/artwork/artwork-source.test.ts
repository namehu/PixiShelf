import { describe, expect, it } from 'vitest'

import { isLocalDirectoryArtworkSource } from './artwork-source'

describe('isLocalDirectoryArtworkSource', () => {
  it.each(['LOCAL_CREATED', 'LOCAL_IMPORT'] as const)('returns true for %s', (source) => {
    expect(isLocalDirectoryArtworkSource(source)).toBe(true)
  })

  it('returns false for PIXIV_IMPORTED', () => {
    expect(isLocalDirectoryArtworkSource('PIXIV_IMPORTED')).toBe(false)
  })
})
