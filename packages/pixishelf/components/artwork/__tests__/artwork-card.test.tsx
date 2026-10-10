import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePreferredTags } from '@/components/user-setting'
import ArtworkCard from '../artwork-card'

vi.mock('@/components/user-setting', () => ({
  usePreferredTags: vi.fn(() => [])
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

afterEach(() => { cleanup(); vi.mocked(usePreferredTags).mockReturnValue([]) })

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

  it('shows reading progress without changing the artwork link', () => {
    render(<ArtworkCard artwork={artwork as never} showReadingStatus reading={{
      artworkId: 42, mediaRevision: 1, stateVersion: 0, viewCount: 2, seenCount: 1, totalCount: 3, status: 'IN_PROGRESS',
      lastViewedAt: null, lastActiveAt: null, lastMediaId: 1, lastMediaIndex: 0
    }} />)
    expect(screen.getByRole('link', { name: '查看作品：可选择的作品标题' }).getAttribute('aria-description')).toBeNull()
    expect(screen.queryByText('1/3')).toBeNull()
    expect(screen.getByRole('link').getAttribute('title')).toBeNull()
    const marker = screen.getByRole('link').querySelector('[data-slot="reading-marker"]')
    expect(marker?.textContent).toBe('')
    expect(marker?.querySelector('circle')).toBeNull()
    expect(marker?.getAttribute('class')).toContain('text-primary')
  })

  it('marks unread covers with a small triangle without additional status text', () => {
    render(<ArtworkCard artwork={artwork as never} showReadingStatus />)
    expect(screen.queryByText('未看')).toBeNull()
    expect(screen.getByRole('link').getAttribute('aria-description')).toBeNull()
    const marker = screen.getByRole('link').querySelector('[data-slot="reading-marker"]')
    expect(marker?.querySelector('path')).toBeTruthy()
    expect(marker?.getAttribute('class')).toContain('text-destructive')
  })

  it('keeps the preferred tag in its original position when reading status is enabled', () => {
    vi.mocked(usePreferredTags).mockReturnValue(['收藏'])
    const tagged = { ...artwork, tags: [{ id: 1, name: '收藏' }] }
    const view = render(<ArtworkCard artwork={tagged as never} />)
    const original = screen.getByText('收藏').parentElement!.className
    view.rerender(<ArtworkCard artwork={tagged as never} showReadingStatus />)
    expect(screen.getByText('收藏').parentElement!.className).toBe(original)
    expect(original).toContain('top-2')
    expect(screen.getByRole('link').querySelector('[data-slot="reading-marker"]')).toBeTruthy()
  })

  it('leaves completed covers unmarked in minimal mode', () => {
    render(<ArtworkCard artwork={artwork as never} displayMode="minimal" showReadingStatus reading={{
      artworkId: 42, mediaRevision: 1, stateVersion: 0, viewCount: 2, seenCount: 3, totalCount: 3, status: 'COMPLETED',
      lastViewedAt: null, lastActiveAt: null, lastMediaId: 1, lastMediaIndex: 0
    }} />)
    expect(screen.getByRole('link').getAttribute('aria-description')).toBeNull()
    expect(screen.queryByText('3/3')).toBeNull()
    expect(screen.getByRole('link').querySelector('[data-slot="reading-marker"]')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
  })
})
