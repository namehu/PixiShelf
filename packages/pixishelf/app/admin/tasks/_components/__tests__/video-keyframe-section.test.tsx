import type { PropsWithChildren } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoKeyframeSection } from '../video-keyframe-section'

const mocks = vi.hoisted(() => ({
  startBatch: vi.fn(),
  queueData: {
    capacity: 100,
    automaticCapacity: 90,
    active: [],
    recent: [],
    discoveryActive: [],
    discoveryRecent: []
  } as any
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey?: string[] }) => ({
    data: options.queryKey?.[0] === 'video-keyframe-queue' ? mocks.queueData : [],
    refetch: vi.fn()
  }),
  useMutation: (options: { mutationKey?: string[] }) => ({
    mutate: (variables: unknown) => {
      if (options.mutationKey?.[0] === 'start-video-keyframe-batch') mocks.startBatch(variables)
    },
    isPending: false
  })
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    job: {
      getVideoKeyframeQueue: { queryOptions: () => ({ queryKey: ['video-keyframe-queue'] }) },
      listScheduledTasks: { queryOptions: () => ({ queryKey: ['scheduled-tasks'] }) },
      updateScheduledTask: { mutationOptions: (options: object) => ({ ...options, mutationKey: ['update-task'] }) },
      startVideoKeyframeBatch: {
        mutationOptions: (options: object) => ({ ...options, mutationKey: ['start-video-keyframe-batch'] })
      },
      controlVideoKeyframe: { mutationOptions: (options: object) => ({ ...options, mutationKey: ['control'] }) },
      retryVideoKeyframe: { mutationOptions: (options: object) => ({ ...options, mutationKey: ['retry'] }) }
    }
  })
}))

vi.mock('../task-ui', () => ({
  TaskSection: ({ children }: PropsWithChildren) => <div>{children}</div>
}))

describe('VideoKeyframeSection manual preview', () => {
  beforeEach(() => {
    mocks.startBatch.mockReset()
    mocks.queueData = {
      capacity: 100,
      automaticCapacity: 90,
      active: [],
      recent: [],
      discoveryActive: [],
      discoveryRecent: [
        {
          id: 'preview-1',
          type: 'VIDEO_KEYFRAME_DISCOVERY',
          status: 'COMPLETED',
          progress: 100,
          createdAt: '2026-08-13T08:00:00.000Z',
          result: {
            previewOnly: true,
            previewTruncated: false,
            matched: 2,
            force: false,
            filter: {
              minDuration: 0,
              maxDuration: 600,
              includePaths: [],
              excludePaths: [],
              statuses: ['MISSING', 'FAILED']
            },
            candidates: [
              { imageId: 9, path: '/artist/a.mp4', duration: 39.4, status: 'MISSING', publishedCount: 0 },
              { imageId: 10, path: '/artist/b.mp4', duration: 42, status: 'FAILED', publishedCount: 0 }
            ]
          }
        }
      ]
    }
  })

  afterEach(cleanup)

  it('does not enqueue during preview and submits only explicitly selected videos', () => {
    render(<VideoKeyframeSection />)

    expect(screen.getByText('找到 2 个视频 · 已选 0 个')).toBeTruthy()
    expect(mocks.startBatch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox', { name: '选择媒体 9' }))
    expect(mocks.startBatch).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确认处理 1 个' }))
    expect(mocks.startBatch).toHaveBeenCalledOnce()
    expect(mocks.startBatch).toHaveBeenCalledWith({
      imageIds: [9],
      force: false,
      previewOnly: false,
      filter: {
        minDuration: 0,
        maxDuration: 600,
        includePaths: [],
        excludePaths: [],
        statuses: ['MISSING', 'FAILED']
      }
    })
  })

  it('keeps other concurrent previews visible and reports inaccessible samples', () => {
    mocks.queueData.discoveryRecent[0].result.inaccessible = 1
    mocks.queueData.discoveryRecent[0].result.failedSamples = [
      { imageId: 88, path: '/broken/video.mp4', error: 'FFprobe failed' }
    ]
    mocks.queueData.discoveryActive = [
      {
        id: 'preview-older-running',
        type: 'VIDEO_KEYFRAME_DISCOVERY',
        status: 'RUNNING',
        progress: 30,
        message: '正在筛选旧请求',
        createdAt: '2026-08-13T07:00:00.000Z',
        result: { request: { previewOnly: true } }
      }
    ]

    render(<VideoKeyframeSection />)

    expect(screen.getByText('找到 2 个视频 · 已选 0 个')).toBeTruthy()
    expect(screen.getByText('1 个视频无法读取或探测，未列入候选。')).toBeTruthy()
    expect(screen.getByText(/#88 \/broken\/video\.mp4：FFprobe failed/)).toBeTruthy()
    expect(screen.getByText('其他筛选任务')).toBeTruthy()
    expect(screen.getByText('正在筛选旧请求')).toBeTruthy()
  })
})
