import type { PropsWithChildren } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoStreamingOptimizationSection } from '../video-streaming-optimization-section'

const mocks = vi.hoisted(() => ({
  queueData: {
    capacity: 100,
    active: [],
    failureAttentionCount: 0,
    recent: []
  } as any
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.queueData, refetch: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined })
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    job: {
      getVideoStreamingOptimizationQueue: { queryOptions: () => ({}) },
      cancelVideoStreamingOptimization: { mutationOptions: (options: object) => options },
      startVideoStreamingOptimization: { mutationOptions: (options: object) => options }
    }
  })
}))

vi.mock('@/components/shared/global-confirm', () => ({ confirm: vi.fn() }))
vi.mock('../../_components/admin-status-badge', () => ({
  AdminStatusBadge: ({ children }: PropsWithChildren) => <span>{children}</span>
}))
vi.mock('../task-ui', () => ({
  TaskSection: ({
    children,
    summary,
    tone
  }: PropsWithChildren<{ summary?: string | null; tone: string }>) => (
    <section data-testid="video-streaming-section" data-tone={tone}>
      {summary ? <p>{summary}</p> : null}
      {children}
    </section>
  )
}))

function failedJob(id: string, targetImageId: number, failureNeedsAttention: boolean, retryAllowed: boolean) {
  return {
    id,
    status: 'FAILED',
    progress: 82,
    targetImageId,
    targetPath: `/video/${targetImageId}.mp4`,
    error: 'Optimized media streams differ from the source',
    createdAt: '2026-08-27T02:00:00.000Z',
    failureNeedsAttention,
    retryAllowed
  }
}

describe('VideoStreamingOptimizationSection failure attention', () => {
  beforeEach(() => {
    mocks.queueData = {
      capacity: 100,
      active: [],
      failureAttentionCount: 0,
      recent: []
    }
  })

  afterEach(cleanup)

  it('keeps superseded failures as history without showing a needs-attention summary', () => {
    mocks.queueData.recent = [
      failedJob('failed-1', 1, false, false),
      failedJob('failed-2', 1, false, false),
      failedJob('failed-3', 2, false, false),
      failedJob('failed-4', 2, false, false)
    ]

    render(<VideoStreamingOptimizationSection />)

    expect(screen.queryByText(/需要处理/)).toBeNull()
    expect(screen.getByTestId('video-streaming-section').getAttribute('data-tone')).toBe('idle')
    expect(screen.getAllByText('历史记录')).toHaveLength(4)
    expect(screen.queryByRole('button', { name: '重新加入队列' })).toBeNull()
  })

  it('counts and offers retry only for the current unacknowledged failure', () => {
    mocks.queueData.failureAttentionCount = 1
    mocks.queueData.recent = [
      failedJob('failed-current', 1, true, true),
      failedJob('failed-old', 1, false, false)
    ]

    render(<VideoStreamingOptimizationSection />)

    expect(screen.getByText('需要处理 · 1 项失败')).toBeTruthy()
    expect(screen.getByTestId('video-streaming-section').getAttribute('data-tone')).toBe('error')
    expect(screen.getAllByRole('button', { name: '重新加入队列' })).toHaveLength(1)
  })
})
