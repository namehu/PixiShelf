import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ArtworkCard from '../artwork-card'

vi.mock('@/components/user-setting', () => ({
  usePreferredTags: () => []
}))

vi.mock('@/components/media/media-thumbnail', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />
}))

const artwork = {
  id: 42,
  title: '可选择的作品标题',
  imageCount: 2,
  totalMediaSize: 0,
  images: [{ id: 1, path: '/cover.jpg', mediaType: 'image' as const }],
  artist: { id: 7, name: '示例艺术家' },
  tags: []
}

afterEach(cleanup)

describe('ArtworkCard', () => {
  it('keeps navigation on the cover and metadata outside the link', () => {
    render(<ArtworkCard artwork={artwork as never} />)

    const coverLink = screen.getByRole('link', { name: '查看作品：可选择的作品标题' })
    expect(coverLink.getAttribute('href')).toBe('/artworks/42')
    expect(screen.getByRole('heading', { name: '可选择的作品标题' }).closest('a')).toBeNull()
    expect(screen.getByText('示例艺术家').closest('a')).toBeNull()
    expect(screen.getByText('示例艺术家').className).not.toContain('select-none')
  })

  it('keeps minimal mode image-only with an accessible cover link', () => {
    render(<ArtworkCard artwork={artwork as never} displayMode="minimal" />)

    expect(screen.getByRole('link', { name: '查看作品：可选择的作品标题' })).toBeTruthy()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByText('示例艺术家')).toBeNull()
  })
})
