import { describe, expect, test } from 'vitest'
import {
  getChapterActionLabel,
  getFirstImageDirectory,
  getImageAspectRatio,
  getImageManagerStats,
  getNextImageSortOrder,
  getVideoMetadataSummary,
  isVideoImageListItem
} from '../image-manager-utils'
import type { ImageListItem } from '../types'

function image(overrides: Partial<ImageListItem>): ImageListItem {
  return {
    id: 1,
    path: '/artist/work/1_p0.jpg',
    sortOrder: 0,
    width: 100,
    height: 200,
    size: 10,
    ...overrides
  }
}

describe('image manager utils', () => {
  test('detects video by mediaType before falling back to extension', () => {
    expect(isVideoImageListItem(image({ mediaType: 'video', path: '/a/b/file.jpg' }))).toBe(true)
    expect(isVideoImageListItem(image({ mediaType: 'image', path: '/a/b/file.mp4' }))).toBe(false)
    expect(isVideoImageListItem(image({ mediaType: undefined, path: '/a/b/file.MP4' }))).toBe(true)
    expect(isVideoImageListItem(image({ mediaType: undefined, path: '/a/b/file.jpg' }))).toBe(false)
  })

  test('returns chapter action label from chapter presence', () => {
    expect(getChapterActionLabel(image({ hasChapters: true }))).toBe('替换章节')
    expect(getChapterActionLabel(image({ hasChapters: false }))).toBe('上传章节')
    expect(getChapterActionLabel(image({ hasChapters: undefined }))).toBe('上传章节')
  })

  test('returns video metadata summary for failed, audio, silent and unknown states', () => {
    expect(getVideoMetadataSummary(image({ probeStatus: 'FAILED' })).label).toBe('失败')
    expect(getVideoMetadataSummary(image({ hasAudio: true })).label).toBe('有音频')
    expect(getVideoMetadataSummary(image({ hasAudio: false })).label).toBe('无音频')
    expect(getVideoMetadataSummary(image({ hasAudio: null })).label).toBe('未探测')
  })

  test('uses image aspect ratio when dimensions are valid and fallback otherwise', () => {
    expect(getImageAspectRatio(image({ width: 1920, height: 1080 }))).toBe('1920 / 1080')
    expect(getImageAspectRatio(image({ width: 0, height: 1080 }))).toBe('3 / 4')
    expect(getImageAspectRatio(image({ width: 100, height: null }))).toBe('3 / 4')
  })

  test('calculates next sort order from current media list', () => {
    expect(getNextImageSortOrder([])).toBe(1)
    expect(getNextImageSortOrder([image({ sortOrder: 0 }), image({ sortOrder: 8 })])).toBe(9)
  })

  test('returns first image directory and aggregate stats', () => {
    const images = [
      image({ path: '/artist/work/1_p0.jpg', size: 10 }),
      image({ path: '/artist/work/1_p1.jpg', size: null }),
      image({ path: '/artist/work/1_p2.jpg', size: 30 })
    ]

    expect(getFirstImageDirectory({ images })).toBe('/artist/work')
    expect(getFirstImageDirectory({ images: [] })).toBeNull()
    expect(getImageManagerStats(images)).toEqual({ count: 3, totalSize: 40 })
  })
})
