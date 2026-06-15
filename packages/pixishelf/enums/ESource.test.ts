import { describe, expect, it } from 'vitest'

import { ESource, OSource } from './ESource'

describe('ESource', () => {
  it('matches the ArtworkSource values stored by Prisma', () => {
    expect(Object.values(ESource)).toEqual(['PIXIV_IMPORTED', 'LOCAL_IMPORT', 'LOCAL_CREATED'])
    expect(ESource).not.toHaveProperty('LOCAL_IMPORTED')
  })

  it('uses the same values in source options', () => {
    expect(OSource.map(({ value }) => value)).toEqual(Object.values(ESource))
  })
})
