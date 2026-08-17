import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchEventSource: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  logger: {
    addLog: vi.fn(),
    clearLogs: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('@microsoft/fetch-event-source', () => ({ fetchEventSource: mocks.fetchEventSource }))
vi.mock('sonner', () => ({
  toast: { info: mocks.toastInfo, success: mocks.toastSuccess, error: vi.fn() }
}))
vi.mock('@/hooks/use-logger', () => ({ useLogger: () => mocks.logger }))
vi.mock('@/lib/trpc', () => ({
  useTRPCClient: () => ({
    migration: {
      control: { mutate: vi.fn() },
      failed: { query: vi.fn().mockResolvedValue({ items: [] }) }
    }
  })
}))

import { useMigration, useMigrationStore } from '../use-migration'

describe('useMigration central queued event', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMigrationStore.getState().reset()
    mocks.fetchEventSource.mockImplementation(async (_url, options) => {
      await options.onopen?.(new Response(null, { status: 200 }))
      options.onmessage?.({
        event: 'queued',
        data: JSON.stringify({ success: true, queued: { jobId: 'migration-job-1', status: 'PENDING' } })
      })
    })
  })

  it('releases the local running state and preserves the job id without calling onComplete', async () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useMigration())

    act(() => result.current.actions.startMigration({ targetIds: [7], onComplete }))

    await waitFor(() => expect(result.current.state.jobId).toBe('migration-job-1'))
    expect(result.current.state).toMatchObject({
      migrating: false,
      paused: false,
      scanRunId: null,
      stats: null,
      error: null
    })
    expect(onComplete).not.toHaveBeenCalled()
    expect(mocks.toastInfo).toHaveBeenCalledWith('迁移任务已加入后台队列', {
      description: '任务 ID: migration-job-1'
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.fetchEventSource.mock.calls[0]?.[1].signal.aborted).toBe(true)
  })
})
