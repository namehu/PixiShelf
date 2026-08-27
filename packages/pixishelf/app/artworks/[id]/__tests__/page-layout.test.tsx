import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import artworkDetailPage from '../page'

vi.mock('@/services/artwork-service', () => ({
  getArtworkById: vi.fn(async () => ({
    id: 146,
    title: '测试作品',
    description: '作品描述',
    externalId: null,
    artist: { id: 13, name: '测试艺术家', avatar: null },
    images: [{ id: 1, path: '/media.jpg' }],
    tags: [{ id: 1, name: '测试标签' }],
    series: []
  }))
}))

vi.mock('../_components/nav-head', () => ({ default: () => null }))
vi.mock('../_components/artwork-images', () => ({
  default: () => <div data-testid="artwork-images" />
}))
vi.mock('../_components/artwork-des', () => ({
  default: () => <div data-testid="artwork-description" />
}))
vi.mock('../_components/related-artworks', () => ({ default: () => <div data-testid="related-artworks" /> }))
vi.mock('../_components/series-nav', () => ({ default: () => null }))
vi.mock('../_components/tag-area', () => ({ default: () => <div data-testid="tag-area" /> }))
vi.mock('@/components/artwork/artist-avatar', () => ({ ArtistAvatar: () => <div data-testid="artist-avatar" /> }))

describe('ArtworkDetailPage layout', () => {
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
