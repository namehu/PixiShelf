import { describe, expect, it } from 'vitest'

import { ESource } from '@/enums/ESource'
import { isLocalDirectoryArtworkSource } from './artwork-source'

describe('isLocalDirectoryArtworkSource', () => {
  it.each([ESource.LOCAL_CREATED, ESource.LOCAL_IMPORT])('returns true for %s', (source) => {
    expect(isLocalDirectoryArtworkSource(source)).toBe(true)
  })

  it('returns false for PIXIV_IMPORTED', () => {
    expect(isLocalDirectoryArtworkSource(ESource.PIXIV_IMPORTED)).toBe(false)
  })
})
