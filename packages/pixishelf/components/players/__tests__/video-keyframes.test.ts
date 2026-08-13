import { describe, expect, it } from 'vitest'
import { getNearestVideoKeyframe, normalizeVideoKeyframeManifest } from '../video-keyframes'

const manifest = {
  version: 1,
  imageId: 12,
  publishedAt: '2026-08-13T00:00:00.000Z',
  count: 3,
  frames: [
    { id: 'late', captureTime: 30, selectedOrder: 2, url: '/late.webp' },
    { id: 'early', captureTime: 10, selectedOrder: 0, url: '/early.webp' },
    { id: 'middle', captureTime: 20, selectedOrder: 1, url: '/middle.webp' }
  ]
} as const

describe('video keyframe navigation model', () => {
  it('normalizes frames by their published order', () => {
    expect(normalizeVideoKeyframeManifest(manifest).frames.map((frame) => frame.id)).toEqual([
      'early',
      'middle',
      'late'
    ])
  })

  it('selects the nearest frame and prefers the earlier frame on a tie', () => {
    const frames = normalizeVideoKeyframeManifest(manifest).frames
    expect(getNearestVideoKeyframe(frames, 18)?.id).toBe('middle')
    expect(getNearestVideoKeyframe(frames, 15)?.id).toBe('early')
    expect(getNearestVideoKeyframe(frames, -1)?.id).toBe('early')
  })

  it('rejects a manifest whose count does not match its frame list', () => {
    expect(() => normalizeVideoKeyframeManifest({ ...manifest, count: 4 })).toThrow(/count/i)
  })
})
