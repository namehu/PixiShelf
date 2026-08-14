import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ArtistResponseDto } from '@/schemas/artist.dto'
import { ArtistCard } from '../artist-card'

type MockImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  fill?: boolean
  priority?: boolean
}

vi.mock('next/image', () => ({
  default: (props: MockImageProps) => {
    const imageProps = { ...props }
    delete imageProps.fill
    delete imageProps.priority
    return <img {...imageProps} />
  }
}))

afterEach(cleanup)

describe('ArtistCard', () => {
  it('keeps cover and title as separate links while metadata remains selectable', () => {
    const artist = {
      id: 7,
      name: 'Mika',
      username: 'mika_art',
      avatar: '/avatar.jpg',
      backgroundImg: '/cover.jpg',
      artworksCount: 24,
      createdAt: '2026-08-01T00:00:00.000Z'
    } as ArtistResponseDto

    render(<ArtistCard artist={artist} />)

    expect(screen.getByRole('link', { name: '查看艺术家：Mika' }).getAttribute('href')).toBe('/artists/7')
    expect(screen.getByRole('link', { name: 'Mika' }).getAttribute('href')).toBe('/artists/7')

    const count = screen.getByText('24 件作品')
    expect(count.closest('a')).toBeNull()
    expect(count.closest('.select-none')).toBeNull()
    expect(screen.getByText('@mika_art').closest('a')).toBeNull()
  })
})
