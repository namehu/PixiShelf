import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import ArtworkImages from './artwork-images'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useUserSettingsStore } from '@/components/user-setting'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => children,
  PopoverAnchor: () => null,
  PopoverContent: () => null
}))

vi.mock('./lazy-media', () => ({
  default: ({ index }: { index: number }) => <div data-testid="real-virtual-media">Image {index + 1}</div>
}))

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('ArtworkImages with the real window virtualizer', () => {
  beforeEach(() => {
    global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    Element.prototype.getBoundingClientRect = () =>
      ({
        width: 656,
        height: 500,
        x: 0,
        y: 0,
        top: 200,
        right: 656,
        bottom: 700,
        left: 0,
        toJSON: () => ({})
      }) as DOMRect
    useUserSettingsStore.getState().hydrateSettings({ artwork_media_anchor_interval: 50 })
  })

  afterEach(() => {
    cleanup()
  })

  it('settles after measuring instead of entering a render loop', async () => {
    const images: ArtworkImageResponseDto[] = Array.from({ length: 120 }, (_, index) => ({
      id: index + 1,
      path: `/image-${index + 1}.jpg`,
      width: 1000,
      height: 1500,
      size: null,
      sortOrder: index,
      artworkId: 1,
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
      webpAnimationStatus: null,
      chaptersPath: null,
      chaptersCount: 0,
      chaptersDuration: null,
      chaptersUpdatedAt: null,
      chaptersHash: null,
      mediaType: 'image',
      hasChapters: false,
      chaptersUrl: null
    }))

    render(<ArtworkImages images={images} artworkId={1} />)

    await waitFor(() => {
      expect(screen.getByTestId('artwork-images-container')).toBeTruthy()
      expect(screen.getAllByTestId('real-virtual-media').length).toBeGreaterThan(0)
    })
  })
})
