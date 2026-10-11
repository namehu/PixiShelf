import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), enqueue: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.getSession } } }))
vi.mock('@/services/media-root-central-service', () => ({ enqueueCentralMigration: mocks.enqueue }))
import { POST as post } from '../route'
const request = () =>
  new NextRequest('http://localhost/api/migration/stream', {
    method: 'POST',
    body: JSON.stringify({ targetIds: [1], transferMode: 'move', cleanupSource: true }),
    headers: {
      'content-type': 'application/json',
      cookie: 'better-auth.session_token=invalid',
      'x-user-session': '{"userId":"forged"}'
    }
  })
describe('migration real session gate', () => {
  beforeEach(() => vi.resetAllMocks())
  it.each([null, {}, { user: {} }])('does not enqueue destructive work for invalid session %j', async (session) => {
    mocks.getSession.mockResolvedValue(session)
    expect((await post(request(), { params: Promise.resolve({}) })).status).toBe(401)
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
  it('fails closed on provider outage without leaking credentials', async () => {
    mocks.getSession.mockRejectedValue(new Error('password=synthetic-provider-secret'))
    const response = await post(request(), { params: Promise.resolve({}) })
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('synthetic-provider-secret')
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })
  it('records the authenticated actor when enqueueing', async () => {
    mocks.getSession.mockResolvedValue({ user: { id: 'owner' } })
    mocks.enqueue.mockResolvedValue({ jobId: 'fixture', status: 'PENDING', reused: false })
    expect((await post(request(), { params: Promise.resolve({}) })).status).toBe(200)
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ requestedByUserId: 'owner' }))
  })
})
