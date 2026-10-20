import { describe, expect, it } from 'vitest'
import { decodeReadingSnapshots } from '../pixiv-reading-backfill-sql'

describe('DBX reading snapshot decoding', () => {
  const images = [{ id: 2, path: '1/1.jpg', mediaType: 'IMAGE', sortOrder: 0 }]
  it.each([true, false])('validates JSON columns with string transport=%s', (encoded) => {
    const column = (value: unknown) => encoded ? JSON.stringify(value) : value
    expect(decodeReadingSnapshots([{
      id: 1, mediaRevision: 1, images: column(images), summary: column(null), readMedia: column([])
    }])).toEqual([{ id: 1, mediaRevision: 1, images, summary: null, readMedia: [] }])
  })
  it('rejects incomplete media before generating SQL', () => {
    expect(() => decodeReadingSnapshots([{
      id: 1, mediaRevision: 1, images: JSON.stringify([{ id: 2 }]), summary: null, readMedia: '[]'
    }])).toThrow()
  })
})
