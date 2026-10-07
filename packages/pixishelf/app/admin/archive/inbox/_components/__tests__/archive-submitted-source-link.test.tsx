import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ArchiveSubmittedSourceLink } from '../archive-submitted-source-link'

afterEach(cleanup)
describe('submitted source links', () => {
  it.each(['https://e-hentai.org/g/3453089/fa7a38a99c/', 'https://e-hentai.org/s/abcdef/123-1'])(
    'opens the original locator without resolved metadata: %s',
    (url) => {
      render(<ArchiveSubmittedSourceLink url={url} />)
      const link = screen.getByRole('link', { name: url })
      expect(link.getAttribute('href')).toBe(url)
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
      expect(link.closest('[data-privacy-sensitive]')).not.toBeNull()
    }
  )
  it.each([
    'javascript:alert(1)',
    'http://e-hentai.org/g/1/abc/',
    'https://e-hentai.org.evil.test/g/1/abc/',
    'https://user:secret@e-hentai.org/g/1/abc/',
    'https://e-hentai.org:444/g/1/abc/',
    'https://e-hentai.org/redirect?url=evil',
    'not a url'
  ])('renders unsafe/unsupported input as text: %s', (url) => {
    render(<ArchiveSubmittedSourceLink url={url} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(url)).toBeTruthy()
  })
})
