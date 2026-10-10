import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import artworkDetailPage from '../page'

vi.mock('@/services/artwork-service', () => ({
  getArtworkById: vi.fn(async () => ({
    id: 146,
    title: '测试作品',
    description: '作品描述',
    externalId: '12345',
    artist: { id: 13, name: '测试艺术家', avatar: null },
    creators: [{ id: 13, name: '测试艺术家', avatar: null, kind: 'PERSON', pixivUserId: '67890' }],
    images: [{ id: 1, path: '/media.jpg' }],
    tags: [{ id: 1, name: '测试标签' }],
    series: []
  }))
}))

vi.mock('../_components/nav-head', () => ({ default: () => null }))
vi.mock('../_components/artwork-media-section', () => ({
  ArtworkMediaSection: () => <div data-testid="artwork-images" />
}))
vi.mock('../_components/artwork-des', () => ({
  default: () => <div data-testid="artwork-description" />
}))
vi.mock('../_components/related-artworks', () => ({ default: () => <div data-testid="related-artworks" /> }))
vi.mock('../_components/series-nav', () => ({ default: () => null }))
vi.mock('../_components/tag-area', () => ({ default: () => <div data-testid="tag-area" /> }))
vi.mock('@/components/artwork/artist-avatar', () => ({ ArtistAvatar: () => <div data-testid="artist-avatar" /> }))

afterEach(cleanup)

describe('ArtworkDetailPage layout', () => {
  it('renders distinct icon-only Pixiv links with accessible names and safe new tabs', async () => {
    render(await artworkDetailPage({ params: Promise.resolve({ id: '146' }) } as Parameters<typeof artworkDetailPage>[0]))

    const author = screen.getByRole('link', { name: '在 Pixiv 查看该作者主页（新标签页）' })
    const original = screen.getByRole('link', { name: '在 Pixiv 查看该作品（新标签页）' })
    expect(author.getAttribute('href')).toBe('https://www.pixiv.net/users/67890')
    expect(original.getAttribute('href')).toBe('https://www.pixiv.net/artworks/12345')
    for (const link of [author, original]) {
      expect(link.textContent).toBe('')
      expect(link.querySelector('svg[aria-hidden="true"]')).toBeTruthy()
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }
  })

  it('keeps metadata constrained while rendering artwork media outside the padded containers', async () => {
    const props = {
      params: Promise.resolve({ id: '146' })
    } as Parameters<typeof artworkDetailPage>[0]

    render(await artworkDetailPage(props))

    const main = screen.getByRole('main')
    const images = screen.getByTestId('artwork-images')

    expect(main.getAttribute('data-slot')).toBeNull()
    expect(main.className).not.toContain('px-4')
    expect(images.closest('[data-slot="page-container"]')).toBeNull()
    expect(screen.getByRole('heading', { name: '测试作品' }).closest('[data-slot="page-container"]')).toBeTruthy()
    expect(screen.getByTestId('tag-area').closest('[data-slot="page-container"]')).toBeTruthy()
    expect(screen.getByTestId('artwork-description').closest('[data-slot="page-container"]')).toBeTruthy()
    expect(screen.getByTestId('related-artworks').closest('[data-slot="page-container"]')).toBeTruthy()
  })
})
