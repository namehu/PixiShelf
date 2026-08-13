import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RecentArtists from '../_components/recent-artists'

vi.mock('@/components/media/media-thumbnail', () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>
}))

describe('dashboard recent artists', () => {
  it('keeps artwork previews and artist metadata as separate links', () => {
    render(
      <RecentArtists
        data={
          [
            {
              id: 7,
              name: '测试艺术家',
              username: 'artist',
              userId: 'artist-7',
              avatar: null,
              backgroundImg: null,
              bio: null,
              isStarred: false,
              createdAt: '2026-08-13T00:00:00.000Z',
              updatedAt: '2026-08-13T00:00:00.000Z',
              artworksCount: 12,
              recentArtworks: [
                {
                  id: 42,
                  title: '可选择的作品标题',
                  coverUrl: '/cover.jpg',
                  coverMediaType: 'image'
                }
              ]
            }
          ] as never
        }
      />
    )

    const card = screen.getByRole('article')
    const artworkLink = within(card).getByRole('link', { name: '查看作品：可选择的作品标题' })
    const artistLink = within(card).getByRole('link', { name: '测试艺术家' })

    expect(artworkLink.getAttribute('href')).toBe('/artworks/42')
    expect(artistLink.getAttribute('href')).toBe('/artists/7')
    expect(card.querySelectorAll('a a')).toHaveLength(0)
    expect(card.querySelectorAll('a button, button a')).toHaveLength(0)
  })
})
