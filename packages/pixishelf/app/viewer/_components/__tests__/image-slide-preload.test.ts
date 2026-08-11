import { describe, expect, it } from 'vitest'
import { MediaType } from '@/types'
import type { ViewerMediaItem } from '@/types/images'
import { isViewerMediaPreloadEligible } from '../image-slide'

const image: ViewerMediaItem = {
  id: 1,
  key: 'image-1',
  url: '/image.jpg',
  updatedAt: '2026-08-11T00:00:00.000Z',
  mediaType: MediaType.IMAGE,
  size: 1024 * 1024,
  width: 2000,
  height: 1000
}

describe('isViewerMediaPreloadEligible', () => {
  it('allows adapted static images with incomplete or large source metadata and metadata-only video warmup', () => {
    expect(isViewerMediaPreloadEligible(image, { isMobile: true, saveData: false })).toBe(true)
    expect(
      isViewerMediaPreloadEligible(
        { ...image, size: null, width: null, height: null },
        { isMobile: true, saveData: false }
      )
    ).toBe(true)
    expect(
      isViewerMediaPreloadEligible({ ...image, size: 20 * 1024 * 1024 }, { isMobile: true, saveData: false })
    ).toBe(true)
    expect(
      isViewerMediaPreloadEligible(
        {
          ...image,
          id: 2,
          key: 'video-2',
          url: '/video.mp4',
          mediaType: MediaType.VIDEO,
          size: null,
          width: null,
          height: null
        },
        { isMobile: true, saveData: true }
      )
    ).toBe(true)
  })

  it('rejects animated image neighbors and constrained network modes', () => {
    expect(
      isViewerMediaPreloadEligible(
        { ...image, url: '/animated.gif', isAnimated: true },
        { isMobile: false, saveData: false }
      )
    ).toBe(false)
    expect(isViewerMediaPreloadEligible(image, { isMobile: true, saveData: true })).toBe(false)
    expect(isViewerMediaPreloadEligible(image, { isMobile: true, saveData: false, effectiveType: '2g' })).toBe(false)
  })
})
