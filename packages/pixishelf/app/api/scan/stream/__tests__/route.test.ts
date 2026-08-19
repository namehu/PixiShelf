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
import { ApiError } from '@/lib/api-handler'

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
    mocks.completeJob.mockResolvedValue(undefined)
    mocks.completeScanRun.mockResolvedValue(undefined)
    mocks.scan.mockResolvedValue({
      totalArtworks: 1,
      newArtists: 0,
      newTags: 0,
      skippedArtworks: 0,
      processingTime: 12,
      newArtworks: 1,
      newImages: 2,
      removedArtworks: 0,
      errors: []
    })
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

  it.each([false, true])('rejects a retired directory force scan before %s mode performs I/O', async (central) => {
    mocks.central = central
    const request = new NextRequest('http://localhost/api/scan/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'full', force: true })
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({
      code: 410,
      errorCode: 410,
      success: false,
      data: { reason: 'FULL_SCAN_RETIRED' }
    })
    expect(mocks.requireAdminRequest).toHaveBeenCalledOnce()
    expect(mocks.getScanPath).not.toHaveBeenCalled()
    expect(mocks.enqueueCentralScan).not.toHaveBeenCalled()
    expect(mocks.createScanJob).not.toHaveBeenCalled()
    expect(mocks.startScanRun).not.toHaveBeenCalled()
    expect(mocks.scan).not.toHaveBeenCalled()
  })

  it('authenticates before reporting that directory force scan is retired', async () => {
    mocks.requireAdminRequest.mockRejectedValueOnce(new ApiError('Unauthorized', 401))
    const request = new NextRequest('http://localhost/api/scan/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'full', force: true })
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ code: 401, errorCode: 401, error: 'Unauthorized' })
    expect(mocks.getScanPath).not.toHaveBeenCalled()
    expect(mocks.enqueueCentralScan).not.toHaveBeenCalled()
    expect(mocks.createScanJob).not.toHaveBeenCalled()
  })

  it.each([false, true])('passes central list force=%s through without changing its meaning', async (force) => {
    mocks.central = true
    mocks.enqueueCentralScan.mockResolvedValue({ jobId: `job-list-${force}`, status: 'PENDING' })
    const request = new NextRequest('http://localhost/api/scan/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'list', force, metadataList: ['artist/100-meta.json'] })
    })

    const response = await post(request, { params: Promise.resolve({}) })
    const body = await response.text()

    expect(body).toContain('event: queued')
    expect(mocks.enqueueCentralScan).toHaveBeenCalledWith({
      requestedByUserId: 'admin-1',
      type: 'list',
      force,
      metadataList: ['artist/100-meta.json']
    })
  })

  it.each([false, true])('passes legacy list force=%s to the bounded scan', async (force) => {
    const request = new NextRequest('http://localhost/api/scan/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'list', force, metadataList: ['artist/100-meta.json'] })
    })

    const response = await post(request, { params: Promise.resolve({}) })
    await response.text()

    expect(mocks.startScanRun).toHaveBeenCalledWith({ systemJobId: 'job-1', type: 'PIXIV', mode: 'CLIENT_LIST' })
    expect(mocks.scan).toHaveBeenCalledWith(
      expect.objectContaining({ forceUpdate: force, metadataRelativePaths: ['artist/100-meta.json'] })
    )
  })

  it('keeps a legacy full force=false request as directory incremental discovery', async () => {
    const request = new NextRequest('http://localhost/api/scan/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'full', force: false })
    })

    const response = await post(request, { params: Promise.resolve({}) })
    await response.text()

    expect(mocks.startScanRun).toHaveBeenCalledWith({ systemJobId: 'job-1', type: 'PIXIV', mode: 'INCREMENTAL' })
    expect(mocks.scan).toHaveBeenCalledWith(
      expect.objectContaining({ forceUpdate: false, metadataRelativePaths: undefined })
    )
  })

  it('persists a legacy incremental execution failure without reporting completion', async () => {
    mocks.scan.mockRejectedValueOnce(new Error('Failed to process batch 1: database unavailable'))
    const request = new NextRequest('http://localhost/api/scan/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'full', force: false })
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
