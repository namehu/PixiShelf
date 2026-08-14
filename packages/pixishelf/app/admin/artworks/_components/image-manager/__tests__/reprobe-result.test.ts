import { describe, expect, it } from 'vitest'
import { describeVideoReprobeResult } from '../reprobe-result'

describe('video reprobe result presentation', () => {
  it('treats a central result as queued without requiring probe metadata', () => {
    expect(describeVideoReprobeResult({ mode: 'QUEUED', reused: false })).toEqual({
      message: '视频重探测任务已加入队列',
      refreshMedia: false
    })
    expect(describeVideoReprobeResult({ mode: 'QUEUED', reused: true }).message).toBe(
      '已复用队列中的视频重探测任务'
    )
  })

  it('reads audio metadata only from a completed legacy result', () => {
    expect(describeVideoReprobeResult({ mode: 'COMPLETED', metadata: { hasAudio: true } })).toEqual({
      message: '视频重新探测完成：有音频',
      refreshMedia: true
    })
  })
})
