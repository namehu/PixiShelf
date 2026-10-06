import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ materialize: vi.fn() }))

vi.mock('@/services/background-task/schedule-materializer', () => ({
  runScheduleMaterializerTick: mocks.materialize
}))
vi.mock('@/lib/logger', () => ({ default: { warn: vi.fn(), error: vi.fn() } }))

import { GET as get, POST as post } from '../route'

const token = 'isolated-scheduler-test-token'
const request = (method: string, authorization?: string) => new Request('http://localhost/api/internal/scheduler/tick', {
  method,
  headers: {
    'x-user-session': JSON.stringify({ userId: 'forged-admin' }),
    ...(authorization === undefined ? {} : { authorization })
  }
})

describe('internal scheduler token boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('INTERNAL_JOB_TOKEN', token)
  })
  afterEach(() => vi.unstubAllEnvs())

  for (const [method, handler] of [['GET', get], ['POST', post]] as const) {
    it(`${method} fails closed when the token is not configured`, async () => {
      vi.stubEnv('INTERNAL_JOB_TOKEN', '')
      const response = await handler(request(method, `Bearer ${token}`))
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({
        success: false,
        error: 'Internal scheduler is not configured (INTERNAL_JOB_TOKEN missing)'
      })
      expect(mocks.materialize).not.toHaveBeenCalled()
    })

    it.each([undefined, 'Bearer wrong-token', token, `Basic ${token}`])(
      `${method} rejects invalid credentials without materializing schedules: %s`, async (authorization) => {
        const response = await handler(request(method, authorization))
        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({ success: false, error: 'Unauthorized' })
        expect(mocks.materialize).not.toHaveBeenCalled()
      }
    )
  }

  it('only checks health for an authenticated GET', async () => {
    const response = await get(request('GET', `Bearer ${token}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: { status: 'ok' } })
    expect(mocks.materialize).not.toHaveBeenCalled()
  })

  it('allows an authenticated POST to materialize schedules', async () => {
    const result = { enqueued: 2 }
    mocks.materialize.mockResolvedValue(result)
    const response = await post(request('POST', `Bearer ${token}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, data: result })
    expect(mocks.materialize).toHaveBeenCalled()
  })
})
