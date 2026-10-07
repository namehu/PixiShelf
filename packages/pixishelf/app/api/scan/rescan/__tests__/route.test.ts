import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  central: true,
  requireAdmin: vi.fn(),
  enqueue: vi.fn(),
  artworkFindUnique: vi.fn(),
  pixivRescan: vi.fn(),
  localRescan: vi.fn(),
  getScanPath: vi.fn(),
  determinePath: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/services/background-task/dispatcher-cutover', () => ({
  isCentralDispatcherCutoverEnabled: () => mocks.central
}))
vi.mock('@/services/background-task/request-auth', () => ({ requireAdminRequest: mocks.requireAdmin }))
vi.mock('@/services/media-root-central-service', () => ({ enqueueCentralArtworkRescan: mocks.enqueue }))
vi.mock('@/lib/prisma', () => ({ prisma: { artwork: { findUnique: mocks.artworkFindUnique } } }))
vi.mock('@/services/scan-service', () => ({ rescanArtwork: mocks.pixivRescan, rescanLocalArtwork: mocks.localRescan }))
vi.mock('@/services/setting.service', () => ({ getScanPath: mocks.getScanPath }))
vi.mock('@/services/artwork-service/utils', () => ({ determineArtworkRelDir: mocks.determinePath }))
vi.mock('@/services/job-service', () => ({}))
vi.mock('@/services/scan-run-service', () => ({}))

import { ApiError } from '@/lib/api-handler'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'
import { POST } from '../route'
const post = POST

describe('artwork rescan central stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.central = true
    mocks.getScanPath.mockResolvedValue('/media')
    mocks.determinePath.mockReturnValue('artwork')
    mocks.requireAdmin.mockResolvedValue({ userId: 'admin-1' })
    mocks.artworkFindUnique.mockResolvedValue({ id: 42 })
    mocks.enqueue.mockResolvedValue({ jobId: 'rescan-1', scanRunId: 'run-1', status: 'PENDING', reused: false })
  })

  it.each([
    {
      status: 401,
      setup: () => mocks.requireAdmin.mockRejectedValue(new ApiError('Unauthorized', 401)),
      message: 'Unauthorized'
    },
    { status: 404, setup: () => mocks.artworkFindUnique.mockResolvedValue(null), message: 'Artwork not found' },
    {
      status: 409,
      setup: () => mocks.enqueue.mockRejectedValue(new BackgroundTaskError('ACTIVE_JOB_CONFLICT', 'Busy')),
      message: 'Busy'
    },
    {
      status: 500,
      setup: () => mocks.artworkFindUnique.mockRejectedValue(new Error('private SQL error')),
      message: 'Internal Server Error'
    }
  ])('normalizes central pre-stream HTTP $status failures', async ({ status, setup, message }) => {
    setup()
    const response = await post(
      new NextRequest('http://localhost/api/scan/rescan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"artworkId":42}'
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ code: status, message, ...(status === 500 ? { data: null } : {}) })
    if (status === 401) expect(mocks.artworkFindUnique).not.toHaveBeenCalled()
    if (status !== 409) expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.pixivRescan).not.toHaveBeenCalled()
    expect(mocks.localRescan).not.toHaveBeenCalled()
  })

  it('rejects an invalid target before auth and database access', async () => {
    const response = await post(
      new NextRequest('http://localhost/api/scan/rescan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 400,
      message: 'Invalid Request Parameters',
      data: { details: expect.any(String) }
    })
    expect(mocks.requireAdmin).not.toHaveBeenCalled()
    expect(mocks.artworkFindUnique).not.toHaveBeenCalled()
  })

  it('queues local or pixiv artwork by database id without executing either legacy path', async () => {
    const request = new NextRequest('http://localhost/api/scan/rescan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ artworkId: 42 })
    })

    const response = await post(request, { params: Promise.resolve({}) })
    const body = await response.text()

    expect(body).toContain('event: queued')
    expect(body).not.toContain('event: complete')
    expect(body).toContain('rescan-1')
    expect(mocks.enqueue).toHaveBeenCalledWith({ artworkId: 42, requestedByUserId: 'admin-1' })
    expect(mocks.pixivRescan).not.toHaveBeenCalled()
    expect(mocks.localRescan).not.toHaveBeenCalled()
  })
})
