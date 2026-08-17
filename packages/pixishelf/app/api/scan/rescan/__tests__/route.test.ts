import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  central: true,
  requireAdmin: vi.fn(),
  enqueue: vi.fn(),
  artworkFindUnique: vi.fn(),
  pixivRescan: vi.fn(),
  localRescan: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/services/background-task/dispatcher-cutover', () => ({
  isCentralDispatcherCutoverEnabled: () => mocks.central
}))
vi.mock('@/services/background-task/request-auth', () => ({ requireAdminRequest: mocks.requireAdmin }))
vi.mock('@/services/media-root-central-service', () => ({ enqueueCentralArtworkRescan: mocks.enqueue }))
vi.mock('@/lib/prisma', () => ({ prisma: { artwork: { findUnique: mocks.artworkFindUnique } } }))
vi.mock('@/services/scan-service', () => ({ rescanArtwork: mocks.pixivRescan, rescanLocalArtwork: mocks.localRescan }))
vi.mock('@/services/setting.service', () => ({ getScanPath: vi.fn() }))
vi.mock('@/services/job-service', () => ({}))
vi.mock('@/services/scan-run-service', () => ({}))

import { POST } from '../route'
const post = POST

describe('artwork rescan central stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.central = true
    mocks.requireAdmin.mockResolvedValue({ userId: 'admin-1' })
    mocks.artworkFindUnique.mockResolvedValue({ id: 42 })
    mocks.enqueue.mockResolvedValue({ jobId: 'rescan-1', scanRunId: 'run-1', status: 'PENDING', reused: false })
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
