import { describe, expect, it } from 'vitest'
import {
  buildVideoKeyframeCandidateTimes,
  getVideoKeyframeTargetCount,
  selectRepresentativeKeyframes
} from '../policy.js'

describe('video keyframe policy', () => {
  it('keeps candidate work bounded while preserving duration tiers', () => {
    expect(getVideoKeyframeTargetCount(60)).toBe(6)
    expect(getVideoKeyframeTargetCount(3_601)).toBe(20)
    expect(buildVideoKeyframeCandidateTimes(60, 6)).toHaveLength(18)
    expect(buildVideoKeyframeCandidateTimes(100_000, 30)).toHaveLength(90)
  })

  it('selects distinct frames in timeline order', () => {
    const selected = selectRepresentativeKeyframes(
      [
        {
          candidateIndex: 2,
          captureTime: 20,
          path: '2.webp',
          luma: 128,
          sharpness: 20,
          perceptualHash: 'ffffffffffffffff'
        },
        {
          candidateIndex: 0,
          captureTime: 1,
          path: '0.webp',
          luma: 128,
          sharpness: 20,
          perceptualHash: '0000000000000000'
        },
        {
          candidateIndex: 1,
          captureTime: 10,
          path: '1.webp',
          luma: 128,
          sharpness: 20,
          perceptualHash: '0000000000000000'
        }
      ],
      3
    )
    expect(selected.map((frame) => frame.candidateIndex)).toEqual([0, 2])
  })
})
