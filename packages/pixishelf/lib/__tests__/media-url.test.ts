import { describe, expect, it } from 'vitest'
import { withMediaVersion } from '../media-url'

describe('withMediaVersion', () => {
  it('adds an encoded media version to plain and queried URLs', () => {
    expect(withMediaVersion('/artist/image.jpg', '2026-08-11T01:02:03.000Z')).toBe(
      '/artist/image.jpg?v=2026-08-11T01%3A02%3A03.000Z'
    )
    expect(withMediaVersion('/api/image?download=1', 'two words')).toBe('/api/image?download=1&v=two%20words')
  })

  it('leaves an unversioned URL unchanged', () => {
    expect(withMediaVersion('/artist/image.jpg', null)).toBe('/artist/image.jpg')
  })
})
