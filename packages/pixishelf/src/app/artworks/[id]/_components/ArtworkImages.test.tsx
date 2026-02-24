import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import ArtworkImages from './ArtworkImages'
import React from 'react'

// Mock LazyMedia 组件
vi.mock('./LazyMedia', () => ({
  default: ({ src, index }: { src: string; index: number }) => (
    <div data-testid="lazy-media" data-src={src} data-index={index}>
      Image {index + 1}
    </div>
  )
}))

// Mock ResizeObserver for framer-motion if needed
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))

describe('ArtworkImages', () => {
  afterEach(() => {
    cleanup()
  })

  const generateImages = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      path: `/path/to/image-${i + 1}.jpg`
    }))

  it('renders all images when count is <= 10', () => {
    const images = generateImages(9)
    render(<ArtworkImages images={images} />)

    const mediaItems = screen.getAllByTestId('lazy-media')
    expect(mediaItems).toHaveLength(9)

    const button = screen.queryByRole('button', { name: /查看全部/i })
    expect(button).toBeNull()
  })

  it('renders only first 10 images initially when count > 10', () => {
    const images = generateImages(11)
    render(<ArtworkImages images={images} />)

    const mediaItems = screen.getAllByTestId('lazy-media')
    expect(mediaItems).toHaveLength(10)

    const button = screen.getByRole('button', { name: /查看全部 11 张图片/i })
    expect(button).toBeTruthy()
  })

  it('expands to show all images when button is clicked', async () => {
    const images = generateImages(11)
    render(<ArtworkImages images={images} />)

    const button = screen.getByRole('button', { name: /查看全部 11 张图片/i })
    fireEvent.click(button)

    // Wait for new items to appear
    await waitFor(() => {
      const mediaItems = screen.getAllByTestId('lazy-media')
      expect(mediaItems).toHaveLength(11)
    })

    // Button should be gone
    const buttonAfterClick = screen.queryByRole('button', { name: /查看全部/i })
    expect(buttonAfterClick).toBeNull()
  })
})
