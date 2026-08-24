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
  findScanJob: vi.fn(),
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
vi.mock('@/lib/prisma', () => ({
  prisma: {
    systemJob: {
      findFirst: mocks.findScanJob
    }
  }
}))

import { GET, HEAD, POST } from '../route'

const get = GET
const head = HEAD
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
    mocks.findScanJob.mockResolvedValue(null)
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

  it('keeps GET without jobId as an authenticated health check', async () => {
    const response = await get(
      new NextRequest('http://localhost/api/webhooks/scan', {
        headers: { authorization: 'Bearer token' }
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, data: { status: 'ok' } })
    expect(mocks.findScanJob).not.toHaveBeenCalled()
    expect(mocks.enqueueCentralScan).not.toHaveBeenCalled()
    expect(mocks.createScanJob).not.toHaveBeenCalled()
  })

  it('keeps HEAD as an authenticated read-only availability check', async () => {
    const response = await head(
      new NextRequest('http://localhost/api/webhooks/scan', {
        method: 'HEAD',
        headers: { authorization: 'Bearer token' }
      })
    )

    expect(response.status).toBe(204)
    expect(mocks.findScanJob).not.toHaveBeenCalled()
    expect(mocks.enqueueCentralScan).not.toHaveBeenCalled()
    expect(mocks.createScanJob).not.toHaveBeenCalled()
  })

  it.each([
    ['missing credential', undefined, 'token', 401],
    ['wrong credential', 'Bearer wrong', 'token', 401],
    ['missing server configuration', 'Bearer token', undefined, 503]
  ])('rejects job status queries with %s', async (_label, authorization, configuredToken, expectedStatus) => {
    if (configuredToken === undefined) delete process.env.SCAN_WEBHOOK_TOKEN
    else process.env.SCAN_WEBHOOK_TOKEN = configuredToken

    const response = await get(
      new NextRequest('http://localhost/api/webhooks/scan?jobId=job-1', {
        headers: authorization ? { authorization } : undefined
      })
    )

    expect(response.status).toBe(expectedStatus)
    expect(mocks.findScanJob).not.toHaveBeenCalled()
  })

  it('rejects an empty jobId before querying the database', async () => {
    const response = await get(
      new NextRequest('http://localhost/api/webhooks/scan?jobId=', {
        headers: { authorization: 'Bearer token' }
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Invalid jobId' })
    expect(mocks.findScanJob).not.toHaveBeenCalled()
  })

  it('returns a restricted status DTO for a system-triggered scan job', async () => {
    mocks.findScanJob.mockResolvedValue({
      id: 'job-1',
      status: 'COMPLETED',
      progress: 100,
      message: 'Scan completed',
      error: null,
      createdAt: new Date('2026-08-19T01:29:30.000Z'),
      startedAt: new Date('2026-08-19T01:29:31.000Z'),
      finishedAt: new Date('2026-08-19T01:29:37.000Z'),
      scanRun: {
        id: 'run-1',
        totalArtworks: 15,
        processedArtworks: 15,
        succeededArtworks: 15,
        skippedArtworks: 0,
        failedArtworks: 0,
        newImages: 31,
        durationMs: 6_000,
        walkedEntries: 120,
        metadataCandidates: 15,
        inventoryUnchanged: 10,
        contentHashed: 5,
        contentChanged: 4,
        parsedInputs: 4,
        publishedInputs: 2,
        failedInputs: 0,
        discoveryDurationMs: 2_000,
        hashDurationMs: 400,
        publishDurationMs: 900
      }
    })

    const response = await get(
      new NextRequest('http://localhost/api/webhooks/scan?jobId=job-1', {
        headers: { authorization: 'Bearer token' }
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      jobId: 'job-1',
      scanRunId: 'run-1',
      status: 'COMPLETED',
      progress: 100,
      message: 'Scan completed',
      error: null,
      createdAt: '2026-08-19T01:29:30.000Z',
      startedAt: '2026-08-19T01:29:31.000Z',
      finishedAt: '2026-08-19T01:29:37.000Z',
      data: {
        totalArtworks: 15,
        processedArtworks: 15,
        succeededArtworks: 15,
        skippedArtworks: 0,
        failedArtworks: 0,
        newImages: 31,
        durationMs: 6_000,
        walkedEntries: 120,
        metadataCandidates: 15,
        inventoryUnchanged: 10,
        contentHashed: 5,
        contentChanged: 4,
        parsedInputs: 4,
        publishedInputs: 2,
        failedInputs: 0,
        discoveryDurationMs: 2_000,
        hashDurationMs: 400,
        publishDurationMs: 900
      }
    })
    expect(mocks.findScanJob).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'job-1',
          type: 'SCAN',
          triggerSource: 'SYSTEM',
          definitionVersion: { gte: 1 }
        }
      })
    )
  })

  it('keeps inventory metrics nullable for historical and explicit-list runs without comparable measurements', async () => {
    mocks.findScanJob.mockResolvedValue({
      id: 'job-legacy-metrics',
      status: 'COMPLETED',
      progress: 100,
      message: null,
      error: null,
      createdAt: new Date('2026-08-19T01:29:30.000Z'),
      startedAt: null,
      finishedAt: new Date('2026-08-19T01:29:37.000Z'),
      scanRun: {
        id: 'run-legacy-metrics',
        totalArtworks: 1,
        processedArtworks: 1,
        succeededArtworks: 0,
        skippedArtworks: 1,
        failedArtworks: 0,
        newImages: 0,
        durationMs: 7_000,
        walkedEntries: null,
        metadataCandidates: null,
        inventoryUnchanged: null,
        contentHashed: null,
        contentChanged: null,
        parsedInputs: null,
        publishedInputs: null,
        failedInputs: null,
        discoveryDurationMs: null,
        hashDurationMs: null,
        publishDurationMs: null
      }
    })

    const response = await get(
      new NextRequest('http://localhost/api/webhooks/scan?jobId=job-legacy-metrics', {
        headers: { authorization: 'Bearer token' }
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      walkedEntries: null,
      contentHashed: null,
      contentChanged: null,
      hashDurationMs: null
    })
  })

  it('does not expose jobs outside the webhook scan scope', async () => {
    mocks.findScanJob.mockResolvedValue(null)

    const response = await get(
      new NextRequest('http://localhost/api/webhooks/scan?jobId=admin-job', {
        headers: { authorization: 'Bearer token' }
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'Scan job not found' })
  })

  it('returns 202 queued without executing scan after central cutover', async () => {
    mocks.central = true
    mocks.enqueueCentralScan.mockResolvedValue({ jobId: 'job-central', status: 'PENDING', reused: false })
    const request = new NextRequest('http://localhost/api/webhooks/scan', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'full' })
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ queued: true, jobId: 'job-central' })
    expect(mocks.enqueueCentralScan).toHaveBeenCalledWith({
      triggerSource: 'SYSTEM',
      type: 'all',
      metadataList: []
    })
    expect(mocks.scan).not.toHaveBeenCalled()
    expect(mocks.createScanJob).not.toHaveBeenCalled()
  })

  it('keeps an empty request body as the deployed directory-discovery default', async () => {
    mocks.central = true
    mocks.enqueueCentralScan.mockResolvedValue({ jobId: 'job-default', status: 'PENDING', reused: false })
    const request = new NextRequest('http://localhost/api/webhooks/scan', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({})
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      queued: true,
      jobId: 'job-default',
      status: 'PENDING'
    })
    expect(mocks.enqueueCentralScan).toHaveBeenCalledWith({
      triggerSource: 'SYSTEM',
      type: 'all',
      metadataList: []
    })
    expect(mocks.scan).not.toHaveBeenCalled()
    expect(mocks.createScanJob).not.toHaveBeenCalled()
  })

  it('keeps webhook list scans as asynchronous central enqueues without force semantics', async () => {
    mocks.central = true
    mocks.enqueueCentralScan.mockResolvedValue({ jobId: 'job-list', status: 'PENDING', reused: false })
    const request = new NextRequest('http://localhost/api/webhooks/scan', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'list', metadataList: ['artist/100-meta.json'] })
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      queued: true,
      jobId: 'job-list',
      status: 'PENDING'
    })
    expect(mocks.enqueueCentralScan).toHaveBeenCalledWith({
      triggerSource: 'SYSTEM',
      type: 'list',
      metadataList: ['artist/100-meta.json']
    })
    expect(mocks.scan).not.toHaveBeenCalled()
    expect(mocks.createScanJob).not.toHaveBeenCalled()
  })

  it('passes a legacy list request to a CLIENT_LIST scan', async () => {
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
    expect(mocks.scan.mock.calls[0]?.[0]).not.toHaveProperty('forceUpdate')
  })

  it('keeps a legacy full request as directory incremental discovery', async () => {
    const request = new NextRequest('http://localhost/api/webhooks/scan', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'full' })
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    expect(mocks.startScanRun).toHaveBeenCalledWith({ systemJobId: 'job-1', type: 'PIXIV', mode: 'INCREMENTAL' })
    expect(mocks.scan).toHaveBeenCalledWith(
      expect.objectContaining({ metadataRelativePaths: undefined })
    )
    expect(mocks.scan.mock.calls[0]?.[0]).not.toHaveProperty('forceUpdate')
  })

  it('persists a legacy incremental execution failure without reporting completion', async () => {
    mocks.scan.mockRejectedValueOnce(new Error('Failed to process batch 1: database unavailable'))
    const request = new NextRequest('http://localhost/api/webhooks/scan', {
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'full' })
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

  it.each([
    { type: 'full', force: true },
    { type: 'full', force: false },
    { type: 'list', force: true, metadataList: ['artist/100-meta.json'] },
    { type: 'list', force: false, metadataList: ['artist/100-meta.json'] }
  ])('rejects obsolete force field before webhook scan performs I/O', async (body) => {
    const request = new NextRequest('http://localhost/api/webhooks/scan', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      code: 400,
      success: false,
      errorCode: 400,
      error: 'Invalid Request Parameters'
    })
    expect(mocks.getScanPath).not.toHaveBeenCalled()
    expect(mocks.enqueueCentralScan).not.toHaveBeenCalled()
    expect(mocks.createScanJob).not.toHaveBeenCalled()
    expect(mocks.startScanRun).not.toHaveBeenCalled()
    expect(mocks.scan).not.toHaveBeenCalled()
  })

  it('rejects obsolete force field before token-scoped webhook work', async () => {
    const request = new NextRequest('http://localhost/api/webhooks/scan', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'full', force: true })
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ success: false, error: 'Invalid Request Parameters' })
    expect(mocks.getScanPath).not.toHaveBeenCalled()
    expect(mocks.enqueueCentralScan).not.toHaveBeenCalled()
    expect(mocks.createScanJob).not.toHaveBeenCalled()
  })
})
