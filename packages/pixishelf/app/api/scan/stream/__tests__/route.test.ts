import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  getScanPath: vi.fn(),
  createScanJob: vi.fn(),
  updateProgress: vi.fn(),
  completeJob: vi.fn(),
  getJob: vi.fn(),
  markAsCancelled: vi.fn(),
  failJob: vi.fn(),
  startScanRun: vi.fn(),
  createScanRunItemBuffer: vi.fn(),
  completeScanRun: vi.fn(),
  cancelScanRun: vi.fn(),
  failScanRun: vi.fn(),
  requireAdminRequest: vi.fn(),
  central: false,
  enqueueCentralScan: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('@/services/scan-service', () => ({ scan: mocks.scan }))
vi.mock('@/services/setting.service', () => ({ getScanPath: mocks.getScanPath }))
vi.mock('@/services/job-service', () => ({
  createScanJob: mocks.createScanJob,
  updateProgress: mocks.updateProgress,
  completeJob: mocks.completeJob,
  getJob: mocks.getJob,
  markAsCancelled: mocks.markAsCancelled,
  failJob: mocks.failJob
}))
vi.mock('@/services/scan-run-service', () => ({
  startScanRun: mocks.startScanRun,
  createScanRunItemBuffer: mocks.createScanRunItemBuffer,
  completeScanRun: mocks.completeScanRun,
  cancelScanRun: mocks.cancelScanRun,
  failScanRun: mocks.failScanRun
}))
vi.mock('@/services/background-task/request-auth', () => ({ requireAdminRequest: mocks.requireAdminRequest }))
vi.mock('@/services/background-task/dispatcher-cutover', () => ({
  isCentralDispatcherCutoverEnabled: () => mocks.central
}))
vi.mock('@/services/media-root-central-service', () => ({ enqueueCentralScan: mocks.enqueueCentralScan }))

import { POST } from '../route'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'

const post = POST

describe('scan stream failure state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.central = false
    mocks.requireAdminRequest.mockResolvedValue({ userId: 'admin-1' })
    mocks.getScanPath.mockResolvedValue('D:/scan')
    mocks.createScanJob.mockResolvedValue({ id: 'job-1' })
    mocks.startScanRun.mockResolvedValue({ id: 'run-1' })
    mocks.createScanRunItemBuffer.mockReturnValue({
      recordItems: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined)
    })
    mocks.failJob.mockResolvedValue(undefined)
    mocks.failScanRun.mockResolvedValue(undefined)
  })

  it('only queues and closes the SSE stream after central cutover', async () => {
    mocks.central = true
    mocks.enqueueCentralScan.mockResolvedValue({ jobId: 'job-central', scanRunId: 'run-central', status: 'PENDING' })
    const request = new NextRequest('http://localhost/api/scan/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'full', force: false })
    })

    const response = await post(request, { params: Promise.resolve({}) })
    const body = await response.text()

    expect(body).toContain('event: queued')
    expect(body).not.toContain('event: complete')
    expect(body).toContain('job-central')
    expect(mocks.scan).not.toHaveBeenCalled()
    expect(mocks.createScanJob).not.toHaveBeenCalled()
  })

  it('maps a central active-job conflict to HTTP 409 instead of 500', async () => {
    mocks.central = true
    mocks.enqueueCentralScan.mockRejectedValue(
      new BackgroundTaskError('ACTIVE_JOB_CONFLICT', 'Active scan snapshot differs')
    )
    const request = new NextRequest('http://localhost/api/scan/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'full', force: false })
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: 'Active scan snapshot differs' })
  })

  it('maps a central snapshot precondition failure to HTTP 400 instead of 500', async () => {
    mocks.central = true
    mocks.enqueueCentralScan.mockRejectedValue(
      new BackgroundTaskError('PRECONDITION_FAILED', 'Metadata path cannot be read')
    )
    const request = new NextRequest('http://localhost/api/scan/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'list', metadataList: ['7-meta.json'], force: false })
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Metadata path cannot be read' })
  })

  it('emits an error event and fails persistence instead of completing a rejected force scan', async () => {
    mocks.scan.mockRejectedValueOnce(new Error('Failed to process batch 1: database unavailable'))
    const request = new NextRequest('http://localhost/api/scan/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'full', force: true })
    })

    const response = await post(request, { params: Promise.resolve({}) })
    const body = await response.text()

    expect(body).toContain('event: error')
    expect(body).toContain('部分作品处理失败，请查看扫描日志')
    expect(body).not.toContain('event: complete')
    expect(mocks.failJob).toHaveBeenCalledWith('job-1', 'Failed to process batch 1: database unavailable')
    expect(mocks.failScanRun).toHaveBeenCalledWith('run-1', 'Failed to process batch 1: database unavailable')
    expect(mocks.completeJob).not.toHaveBeenCalled()
    expect(mocks.completeScanRun).not.toHaveBeenCalled()
  })
})
