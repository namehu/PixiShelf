import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

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
    await expect(response.json()).resolves.toMatchObject({
      error: 'batchSize and concurrency overrides are not supported by the central dispatcher'
    })
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
})
