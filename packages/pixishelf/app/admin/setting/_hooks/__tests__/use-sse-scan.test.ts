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
  toast: { info: mocks.toastInfo, success: mocks.toastSuccess }
}))
vi.mock('@/hooks/use-logger', () => ({ useLogger: () => mocks.logger }))

import { useScanStore } from '@/store/scan-store'
import { useSseScan } from '../use-sse-scan'

describe('useSseScan central queued event', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useScanStore.setState({ isScanning: false, result: null, error: null })
    mocks.fetchEventSource.mockImplementation(async (_url, options) => {
      await options.onopen?.(new Response(null, { status: 200 }))
      options.onmessage?.({
        event: 'queued',
        data: JSON.stringify({
          success: true,
          queued: { jobId: 'scan-job-1', scanRunId: 'scan-run-1', status: 'PENDING' }
        })
      })
    })
  })

  it('releases the local running state and exposes ids without reporting completion', async () => {
    const { result } = renderHook(() => useSseScan())

    act(() => result.current.actions.startScan({ force: false }))

    await waitFor(() => expect(result.current.state.jobId).toBe('scan-job-1'))
    expect(result.current.state).toMatchObject({
      streaming: false,
      scanRunId: 'scan-run-1',
      streamResult: null,
      streamError: null
    })
    expect(mocks.toastInfo).toHaveBeenCalledWith('扫描任务已加入后台队列', {
      description: '任务 ID: scan-job-1'
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.fetchEventSource.mock.calls[0]?.[1].signal.aborted).toBe(true)
  })
})
