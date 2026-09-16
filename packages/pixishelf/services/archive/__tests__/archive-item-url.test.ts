import { describe, expect, it } from 'vitest'
import { archiveItemUrl } from '../archive-item-url'

describe('archive item navigation URL', () => {
  it('preserves the exact path, port and signed query', () => {
    const url = 'https://media.hath.network:2333/image/a%2Fb?key=x%2By&n=1'
    expect(archiveItemUrl(url)).toBe(url)
  })

  it.each([
    null,
    undefined,
    '',
    'javascript:alert(1)',
    'file:///tmp/a',
    '/relative',
    'not a url',
    'https://user:password@example.com/a',
    'https://example.com:99999/a'
  ])('rejects unsafe or missing address %s', (url) => {
    expect(archiveItemUrl(url)).toBeNull()
  })
})
