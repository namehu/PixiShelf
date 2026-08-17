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
  central: false,
  enqueueCentralScan: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('@/services/scan-service', () => ({
  scan: mocks.scan
}))

vi.mock('@/services/setting.service', () => ({
  getScanPath: mocks.getScanPath
}))

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
vi.mock('@/services/background-task/dispatcher-cutover', () => ({
  isCentralDispatcherCutoverEnabled: () => mocks.central
}))
vi.mock('@/services/media-root-central-service', () => ({ enqueueCentralScan: mocks.enqueueCentralScan }))

import { POST } from '../route'

const post = POST

describe('webhook scan audit integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.central = false
    process.env.SCAN_WEBHOOK_TOKEN = 'token'
    mocks.getScanPath.mockResolvedValue('D:/scan')
    mocks.createScanJob.mockResolvedValue({ id: 'job-1' })
    mocks.startScanRun.mockResolvedValue({ id: 'run-1' })
    mocks.createScanRunItemBuffer.mockReturnValue({
      recordItems: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined)
    })
    mocks.updateProgress.mockResolvedValue(undefined)
    mocks.completeJob.mockResolvedValue(undefined)
    mocks.completeScanRun.mockResolvedValue(undefined)
    mocks.failJob.mockResolvedValue(undefined)
    mocks.failScanRun.mockResolvedValue(undefined)
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

  it('returns 202 queued without executing scan after central cutover', async () => {
    mocks.central = true
    mocks.enqueueCentralScan.mockResolvedValue({ jobId: 'job-central', status: 'PENDING', reused: false })
    const request = new NextRequest('http://localhost/api/webhooks/scan', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'full', force: false })
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ queued: true, jobId: 'job-central' })
    expect(mocks.enqueueCentralScan).toHaveBeenCalledWith({
      triggerSource: 'SYSTEM',
      type: 'all',
      force: false,
      metadataList: []
    })
    expect(mocks.scan).not.toHaveBeenCalled()
    expect(mocks.createScanJob).not.toHaveBeenCalled()
  })

  it('creates CLIENT_LIST audit runs for webhook list scans', async () => {
    const request = new NextRequest('http://localhost/api/webhooks/scan', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        type: 'list',
        metadataList: ['artist/100-meta.json']
      })
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mocks.startScanRun).toHaveBeenCalledWith({
      systemJobId: 'job-1',
      type: 'PIXIV',
      mode: 'CLIENT_LIST'
    })
    expect(mocks.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataRelativePaths: ['artist/100-meta.json']
      })
    )
  })

  it('marks the job and scan run as failed when a force rebuild rejects', async () => {
    mocks.scan.mockRejectedValueOnce(new Error('Failed to process batch 1: database unavailable'))
    const request = new NextRequest('http://localhost/api/webhooks/scan', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ type: 'full', force: true })
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: '部分作品处理失败，请查看扫描日志'
    })
    expect(mocks.failJob).toHaveBeenCalledWith('job-1', 'Failed to process batch 1: database unavailable')
    expect(mocks.failScanRun).toHaveBeenCalledWith('run-1', 'Failed to process batch 1: database unavailable')
    expect(mocks.completeJob).not.toHaveBeenCalled()
    expect(mocks.completeScanRun).not.toHaveBeenCalled()
  })
})
