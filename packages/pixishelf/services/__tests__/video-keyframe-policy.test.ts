import { describe, expect, it } from 'vitest'
import {
  buildVideoKeyframeCandidateTimes,
  getVideoKeyframeTargetCount,
  hammingDistanceHex,
  matchesVideoKeyframeFilter,
  normalizeVideoKeyframeFilter,
  selectRepresentativeKeyframes
} from '../video-keyframe-policy'

describe('video keyframe policy', () => {
  it('uses the accepted duration tiers', () => {
    expect(getVideoKeyframeTargetCount(1)).toBe(6)
    expect(getVideoKeyframeTargetCount(600)).toBe(6)
    expect(getVideoKeyframeTargetCount(601)).toBe(12)
    expect(getVideoKeyframeTargetCount(3600)).toBe(12)
    expect(getVideoKeyframeTargetCount(3601)).toBe(20)
    expect(getVideoKeyframeTargetCount(10800)).toBe(20)
    expect(getVideoKeyframeTargetCount(10801)).toBe(30)
    expect(getVideoKeyframeTargetCount(0)).toBe(0)
  })

  it('builds bounded, ordered candidate timestamps away from exact endpoints', () => {
    const candidates = buildVideoKeyframeCandidateTimes(600, 6)
    expect(candidates).toHaveLength(18)
    expect(candidates[0]).toBeGreaterThan(0)
    expect(candidates.at(-1)).toBeLessThan(600)
    expect(candidates).toEqual([...candidates].sort((a, b) => a - b))
  })

  it('normalizes and applies duration plus path-prefix filters', () => {
    const filter = normalizeVideoKeyframeFilter({
      minDuration: 600,
      maxDuration: '3600',
      includePaths: ['Artist A', 'Artist A'],
      excludePaths: ['Artist A/private']
    })
    expect(filter).toEqual({
      minDuration: 600,
      maxDuration: 3600,
      includePaths: ['Artist A'],
      excludePaths: ['Artist A/private'],
      statuses: ['MISSING', 'STALE', 'FAILED']
    })
    expect(matchesVideoKeyframeFilter({ duration: 1200, path: '/artist a/video.mp4' }, filter)).toBe(true)
    expect(matchesVideoKeyframeFilter({ duration: 1200, path: '/artist a/private/video.mp4' }, filter)).toBe(false)
    expect(matchesVideoKeyframeFilter({ duration: 60, path: '/artist a/video.mp4' }, filter)).toBe(false)
  })

  it('can restrict discovery to selected processing states', () => {
    const filter = normalizeVideoKeyframeFilter({ statuses: ['FAILED'] })
    expect(matchesVideoKeyframeFilter({ duration: 120, path: '/video.mp4', status: 'FAILED' }, filter)).toBe(true)
    expect(matchesVideoKeyframeFilter({ duration: 120, path: '/video.mp4', status: 'MISSING' }, filter)).toBe(false)
  })

  it('filters unusable frames and preserves temporal ordering', () => {
    const selected = selectRepresentativeKeyframes(
      [
        candidate(0, 10, 2, 20, '0000000000000000'),
        candidate(1, 20, 100, 15, '0000000000000000'),
        candidate(2, 30, 110, 18, 'ffffffffffffffff'),
        candidate(3, 40, 250, 20, 'aaaaaaaaaaaaaaaa')
      ],
      2
    )
    expect(selected.map((item) => item.candidateIndex)).toEqual([1, 2])
  })

  it('backfills an empty time bucket from globally distinct candidates', () => {
    const selected = selectRepresentativeKeyframes(
      [
        candidate(0, 10, 100, 30, '0000000000000000'),
        candidate(1, 20, 100, 20, 'ffffffffffffffff'),
        candidate(2, 30, 100, 30, '0000000000000000'),
        candidate(3, 40, 100, 20, '0000000000000000'),
        candidate(4, 50, 100, 30, '00ff00ff00ff00ff'),
        candidate(5, 60, 100, 20, '00ff00ff00ff00ff')
      ],
      3
    )

    expect(selected.map((item) => item.candidateIndex)).toEqual([0, 1, 4])
  })

  it('deduplicates even when valid candidates do not exceed the target', () => {
    const selected = selectRepresentativeKeyframes(
      [
        candidate(0, 10, 100, 20, '0000000000000000'),
        candidate(1, 20, 100, 20, '0000000000000000'),
        candidate(2, 30, 100, 20, 'ffffffffffffffff')
      ],
      3
    )

    expect(selected.map((item) => item.candidateIndex)).toEqual([0, 2])
  })

  it('calculates hexadecimal perceptual-hash distance', () => {
    expect(hammingDistanceHex('0', 'f')).toBe(4)
    expect(hammingDistanceHex('00', '01')).toBe(1)
    expect(hammingDistanceHex('0', '00')).toBe(Number.POSITIVE_INFINITY)
  })
})

function candidate(
  candidateIndex: number,
  captureTime: number,
  luma: number,
  sharpness: number,
  perceptualHash: string
) {
  return { candidateIndex, captureTime, path: `${candidateIndex}.webp`, luma, sharpness, perceptualHash }
}
