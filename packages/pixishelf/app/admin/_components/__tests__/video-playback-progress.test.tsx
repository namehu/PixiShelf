import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JobDto, VideoPlaybackProgressData } from '@pixishelf/job-contracts'
import { VideoPlaybackProgress } from '../video-playback-progress'

const snapshot: VideoPlaybackProgressData = {
  version: 1,
  kind: 'video-playback',
  stage: 'ENCODING',
  durationSeconds: 440,
  encodedSeconds: 100,
  speed: 0.4,
  fps: 12,
  etaSeconds: 850,
  sampledAt: '2026-11-14T05:07:25.000Z',
  stages: [
    { stage: 'PREPARING', startedAt: '2026-11-14T05:03:13.000Z', finishedAt: '2026-11-14T05:03:14.000Z' },
    { stage: 'PROBING', startedAt: '2026-11-14T05:03:14.000Z', finishedAt: '2026-11-14T05:03:15.000Z' },
    { stage: 'ENCODING', startedAt: '2026-11-14T05:03:15.000Z', finishedAt: null }
  ]
}
const job: Pick<JobDto, 'status' | 'progressData' | 'createdAt' | 'startedAt' | 'finishedAt' | 'updatedAt'> = {
  status: 'RUNNING',
  progressData: snapshot,
  createdAt: '2026-11-14T05:03:12.000Z',
  startedAt: '2026-11-14T05:03:13.000Z',
  finishedAt: null,
  updatedAt: snapshot.sampledAt
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('playback task metrics', () => {
  it('distinguishes a queued task awaiting its first sample from historical missing metrics', () => {
    render(<VideoPlaybackProgress job={{ ...job, status: 'PENDING', startedAt: null, progressData: null }} />)
    expect(screen.getByText('任务开始后将显示转码指标和各阶段耗时。')).toBeTruthy()
    expect(screen.queryByText(/升级后/)).toBeNull()
  })
  it('shows rate, encoding ETA and measured phase timings, then suppresses stale estimates', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(snapshot.sampledAt))
    render(<VideoPlaybackProgress job={job} />)
    expect(screen.getByText('0.40× · 12.0 fps')).toBeTruthy()
    expect(screen.getByText('约 14 分 10 秒')).toBeTruthy()
    expect(screen.getByText('转码与封装（进行中）')).toBeTruthy()
    expect(screen.getByText('4 分 10 秒')).toBeTruthy()
    expect(screen.getByText('首次排队')).toBeTruthy()
    act(() => vi.advanceTimersByTime(10_000))
    expect(screen.queryByText('约 14 分 10 秒')).toBeNull()
    expect(screen.getByText('进度暂未更新，剩余时间估算已暂停。')).toBeTruthy()
  })
  it.each(['PAUSED', 'PAUSING', 'CANCELLED', 'FAILED', 'RETRY_WAIT'] as const)(
    'does not present a running estimate for %s',
    (status) => {
      render(<VideoPlaybackProgress job={{ ...job, status }} />)
      expect(screen.queryByText('预计编码剩余：')).toBeNull()
    }
  )
  it('uses the durable terminal time to finish publication timing and preserves metrics after reload', () => {
    const finishedAt = '2026-11-14T05:22:13.300Z'
    render(
      <VideoPlaybackProgress
        job={{
          ...job,
          status: 'COMPLETED',
          finishedAt,
          updatedAt: finishedAt,
          progressData: {
            ...snapshot,
            stage: 'PUBLISHING',
            etaSeconds: null,
            stages: [
              ...snapshot.stages.slice(0, 2),
              { ...snapshot.stages[2]!, finishedAt: '2026-11-14T05:22:12.000Z' },
              { stage: 'VALIDATING', startedAt: '2026-11-14T05:22:12.000Z', finishedAt: '2026-11-14T05:22:13.000Z' },
              { stage: 'PUBLISHING', startedAt: '2026-11-14T05:22:13.000Z', finishedAt: null }
            ]
          }
        }}
      />
    )
    expect(screen.getByText('平均转码速度：')).toBeTruthy()
    expect(screen.getByText('0.30 秒')).toBeTruthy()
    expect(screen.queryByText(/进行中/)).toBeNull()
    expect(screen.queryByText('预计编码剩余：')).toBeNull()
  })
  it('explains missing historical measurements without inventing speeds or phase timings', () => {
    render(
      <VideoPlaybackProgress
        job={{ ...job, status: 'COMPLETED', progressData: null, finishedAt: '2026-11-14T05:22:13.000Z' }}
      />
    )
    expect(screen.getByText(/这次执行未记录转码速度/)).toBeTruthy()
    expect(screen.queryByText('转码速度：')).toBeNull()
    expect(screen.getByText('19 分 0 秒')).toBeTruthy()
  })
})
