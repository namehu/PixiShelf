import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchEventSource: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@microsoft/fetch-event-source', () => ({ fetchEventSource: mocks.fetchEventSource }))
vi.mock('sonner', () => ({
  toast: { info: mocks.toastInfo, success: mocks.toastSuccess, error: mocks.toastError }
}))

import { useSseScan } from '../use-sse-scan'

describe('useSseScan central queued event', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('refreshes task data after queueing and does not report Worker completion from the short SSE response', async () => {
    const onQueued = vi.fn()
    const { result } = renderHook(() => useSseScan({ onQueued }))

    act(() => result.current.actions.startScan({}))

    await waitFor(() => expect(result.current.state.jobId).toBe('scan-job-1'))
    expect(result.current.state).toMatchObject({
      streaming: false,
      scanRunId: 'scan-run-1',
      jobId: 'scan-job-1'
    })
    expect(mocks.toastInfo).toHaveBeenCalledWith('扫描任务已加入后台队列', {
      description: '任务 ID: scan-job-1'
    })
    expect(onQueued).toHaveBeenCalledOnce()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.fetchEventSource.mock.calls[0]?.[1].signal.aborted).toBe(false)
  })

  it('sends explicit metadata list scans without force semantics', async () => {
    const { result } = renderHook(() => useSseScan())

    act(() => result.current.actions.startScan({ metadataList: ['artist/100-meta.json'] }))

    await waitFor(() => expect(mocks.fetchEventSource).toHaveBeenCalledOnce())
    const request = mocks.fetchEventSource.mock.calls[0]?.[1]
    expect(JSON.parse(request.body)).toEqual({
      type: 'list',
      metadataList: ['artist/100-meta.json']
    })
  })

  it('keeps submission failures visible after the log panel is removed', async () => {
    mocks.fetchEventSource.mockImplementationOnce(async (_url, options) => {
      await options.onopen?.(new Response(null, { status: 200 }))
      options.onmessage?.({ event: 'error', data: JSON.stringify({ error: '扫描目录不可访问' }) })
    })
    const { result } = renderHook(() => useSseScan())

    act(() => result.current.actions.startScan({}))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('扫描任务失败', { description: '扫描目录不可访问' }))
    expect(result.current.state.streaming).toBe(false)
  })

  it('reports a non-success HTTP response as a final submission failure', async () => {
    mocks.fetchEventSource.mockImplementationOnce(async (_url, options) => {
      await options.onopen?.(
        new Response(JSON.stringify({ error: 'Worker 暂不可用' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })
    const { result } = renderHook(() => useSseScan())

    act(() => result.current.actions.startScan({}))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('扫描任务提交失败', { description: 'Worker 暂不可用' })
    )
    expect(result.current.state.streaming).toBe(false)
  })

  it('reports an unexpected stream close after connection without pretending the Worker cancelled', async () => {
    mocks.fetchEventSource.mockImplementationOnce(async (_url, options) => {
      await options.onopen?.(new Response(null, { status: 200 }))
      options.onclose?.()
    })
    const { result } = renderHook(() => useSseScan())

    act(() => result.current.actions.startScan({}))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('扫描任务连接已关闭', {
        description: '未收到任务终态，请刷新查看后台任务状态。'
      })
    )
    expect(result.current.state.streaming).toBe(false)
  })

  it('does not report an error when a legacy stream closes after its completion event', async () => {
    mocks.fetchEventSource.mockImplementationOnce(async (_url, options) => {
      await options.onopen?.(new Response(null, { status: 200 }))
      options.onmessage?.({ event: 'complete', data: JSON.stringify({ success: true, result: {} }) })
      options.onclose?.()
    })
    const { result } = renderHook(() => useSseScan())

    act(() => result.current.actions.startScan({}))

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('扫描完成'))
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(result.current.state.streaming).toBe(false)
  })
})
