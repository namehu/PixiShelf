import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-handler'

const mocks = vi.hoisted(() => ({
  central: true,
  requireAdmin: vi.fn(),
  enqueue: vi.fn(),
  runMigrationJob: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/services/background-task/dispatcher-cutover', () => ({
  isCentralDispatcherCutoverEnabled: () => mocks.central
}))
vi.mock('@/services/background-task/request-auth', () => ({ requireAdminRequest: mocks.requireAdmin }))
vi.mock('@/services/media-root-central-service', () => ({ enqueueCentralMigration: mocks.enqueue }))
vi.mock('@/services/migration-service', () => ({ runMigrationJob: mocks.runMigrationJob }))
vi.mock('@/services/job-service', () => ({}))

import { POST } from '../route'
const post = POST

describe('migration central stream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.central = true
    mocks.requireAdmin.mockResolvedValue({ userId: 'admin-1' })
    mocks.enqueue.mockResolvedValue({ jobId: 'migration-1', status: 'PENDING', reused: false })
  })

  it('returns queued SSE semantics without running migration in Next', async () => {
    const request = new NextRequest('http://localhost/api/migration/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetIds: [7] })
    })

    const response = await post(request, { params: Promise.resolve({}) })
    const body = await response.text()

    expect(body).toContain('event: queued')
    expect(body).not.toContain('event: complete')
    expect(body).toContain('migration-1')
    expect(mocks.runMigrationJob).not.toHaveBeenCalled()
  })

  it('rejects legacy execution tuning instead of silently ignoring it', async () => {
    const request = new NextRequest('http://localhost/api/migration/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetIds: [7], concurrency: 2 })
    })

    const response = await post(request, { params: Promise.resolve({}) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      code: 400,
      message: 'batchSize and concurrency overrides are not supported by the central dispatcher'
    })
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it.each([401, 409, 500])('returns canonical HTTP %s errors before opening SSE', async (status) => {
    if (status === 401) mocks.requireAdmin.mockRejectedValueOnce(new ApiError('Unauthorized', 401))
    else {
      mocks.enqueue.mockRejectedValueOnce(
        status === 409 ? new ApiError('Conflict', 409) : new Error('private database path')
      )
    }
    const response = await post(
      new NextRequest('http://localhost/api/migration/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(
      status === 500
        ? { code: 500, message: 'Internal Server Error', data: null }
        : { code: status, message: status === 401 ? 'Unauthorized' : 'Conflict' }
    )
    if (status === 401) expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it.each(['{', '', 'null', '[]', '{"targetIds":"all"}'])(
    'rejects invalid JSON input %s before enqueue',
    async (body) => {
      const response = await post(
        new NextRequest('http://localhost/api/migration/stream', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body
        }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 400, message: 'Invalid Request Parameters' })
      expect(mocks.enqueue).not.toHaveBeenCalled()
    }
  )
})
