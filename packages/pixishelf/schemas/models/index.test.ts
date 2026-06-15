import { describe, expect, it } from 'vitest'
import { ArtworkModel, ArtworkSourceEnum } from './index'

describe('artwork model schemas', () => {
  it('accepts local directory imports as an artwork source', () => {
    expect(ArtworkSourceEnum.safeParse('LOCAL_IMPORT').success).toBe(true)
    expect(ArtworkSourceEnum.safeParse('UNKNOWN_SOURCE').success).toBe(false)
  })

  it('defines storagePath as a nullable string', () => {
    const storagePathSchema = Reflect.get(ArtworkModel.shape, 'storagePath')

    expect(storagePathSchema).toBeDefined()
    expect(storagePathSchema?.safeParse('artists/example/artwork').success).toBe(true)
    expect(storagePathSchema?.safeParse(null).success).toBe(true)
    expect(storagePathSchema?.safeParse(123).success).toBe(false)
    expect(storagePathSchema?.safeParse({ path: 'artists/example/artwork' }).success).toBe(false)
  })
})
