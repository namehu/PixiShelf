import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SeriesCard from '../series-card'

vi.mock('@/components/media/media-thumbnail', () => ({
  default: ({ alt }: { alt: string }) => <img src="/cover.jpg" alt={alt} />
}))

afterEach(cleanup)

describe('SeriesCard', () => {
  it('keeps the cover and title links separate from update metadata', () => {
    render(
      <SeriesCard
        series={{
          id: 3,
          title: '夏日收藏',
          coverImageUrl: '/cover.jpg',
          artworkCount: 16,
          updatedAt: new Date('2026-08-01T00:00:00.000Z')
        }}
      />
    )

    expect(screen.getByRole('link', { name: '查看系列：夏日收藏' }).getAttribute('href')).toBe('/series/3')
    expect(screen.getByRole('link', { name: '夏日收藏' }).getAttribute('href')).toBe('/series/3')
    expect(screen.getByText('16 件作品').closest('a')).toBeNull()
    expect(screen.getByText('16 件作品').closest('.select-none')).toBeNull()
    expect(screen.getByText(/更新$/).closest('a')).toBeNull()
  })
})
