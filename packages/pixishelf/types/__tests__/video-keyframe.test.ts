import { describe, expect, it } from 'vitest'
import {
  formatVideoKeyframeError,
  getVideoKeyframePreviewResult,
  getVideoKeyframeRetryCountdown,
  isVideoKeyframePreviewJob,
  shouldPollVideoKeyframeQueue,
  type VideoKeyframeQueueView
} from '../video-keyframe'

function queue(discoveryStatus: string): VideoKeyframeQueueView {
  return {
    capacity: 100,
    automaticCapacity: 90,
    active: [],
    recent: [],
    discoveryActive: [{ id: 'discovery-1', status: discoveryStatus, progress: 0 }],
    discoveryRecent: []
  }
}

describe('video keyframe queue polling', () => {
  it.each(['PENDING', 'RUNNING'])(
    'keeps polling while a discovery is %s even when the generation queue is empty',
    (status) => {
      expect(shouldPollVideoKeyframeQueue(queue(status))).toBe(true)
    }
  )

  it('stops polling after discovery reaches a terminal status', () => {
    expect(shouldPollVideoKeyframeQueue(queue('FAILED'))).toBe(false)
  })

  it('formats the remaining retry delay for pending work', () => {
    expect(
      getVideoKeyframeRetryCountdown(
        { id: 'job-1', status: 'PENDING', progress: 92, availableAt: '2026-08-13T08:01:05.000Z' },
        Date.parse('2026-08-13T08:00:00.000Z')
      )
    ).toBe('1 分 5 秒后自动重试')
  })

  it('recognizes a durable preview before and after it completes', () => {
    expect(
      isVideoKeyframePreviewJob({
        id: 'preview-pending',
        status: 'PENDING',
        progress: 0,
        result: { request: { previewOnly: true } }
      })
    ).toBe(true)

    const job = {
      id: 'preview-complete',
      status: 'COMPLETED',
      progress: 100,
      result: {
        previewOnly: true,
        matched: 1,
        previewTruncated: false,
        force: false,
        filter: { minDuration: 0, maxDuration: 600, includePaths: [], excludePaths: [], statuses: ['MISSING'] },
        candidates: [{ imageId: 9, path: '/artist/video.mp4', duration: 39.4, status: 'MISSING', publishedCount: 0 }]
      }
    }
    expect(isVideoKeyframePreviewJob(job)).toBe(true)
    expect(getVideoKeyframePreviewResult(job)).toMatchObject({
      matched: 1,
      force: false,
      candidates: [{ imageId: 9, status: 'MISSING' }]
    })
  })

  it('localizes the legacy quality threshold error with the new recovery action', () => {
    expect(formatVideoKeyframeError('Only 2/6 representative frames passed quality checks')).toBe(
      '仅 2/6 张通过质量检查；可重试并按实际有效数量发布'
    )
  })
})
