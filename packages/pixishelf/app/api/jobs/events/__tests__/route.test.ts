import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireAdminRequest: vi.fn() }))
vi.mock('@/services/background-task/request-auth', () => ({ requireAdminRequest: mocks.requireAdminRequest }))

import { GET as getJobEvents, createJobEventStreamResponse } from '../route'

describe('job event SSE response', () => {
  beforeEach(() => mocks.requireAdminRequest.mockResolvedValue({ userId: 'admin-1' }))
  afterEach(() => vi.useRealTimers())

  it('returns 401 when the route-level Session check fails', async () => {
    mocks.requireAdminRequest.mockImplementationOnce(() => {
      const error = new Error('Unauthorized') as Error & { statusCode: number }
      error.statusCode = 401
      throw error
    })

    const response = await getJobEvents(new Request('http://localhost/api/jobs/events'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('rejects an invalid cursor before opening a database stream', async () => {
    const response = await getJobEvents(new Request('http://localhost/api/jobs/events?afterEventId=not-a-cursor'))

    expect(response.status).toBe(400)
  })

  it('sets anti-buffering headers and resets an ahead cursor before becoming ready', async () => {
    const requestController = new AbortController()
    const source = {
      watermark: vi.fn().mockResolvedValue('10'),
      readAfter: vi.fn().mockResolvedValue({ version: 1, cursor: '10', items: [] })
    }
    const response = createJobEventStreamResponse(
      new Request('http://localhost/api/jobs/events', { signal: requestController.signal }),
      source,
      '99'
    )

    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform')
    expect(response.headers.get('x-accel-buffering')).toBe('no')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const reset = decoder.decode((await reader.read()).value)
    const ready = decoder.decode((await reader.read()).value)
    expect(reset).toContain('event: jobs.reset')
    expect(reset).toContain('id: 10')
    expect(ready).toContain('event: jobs.ready')
    requestController.abort()
    await reader.cancel()
  })

  it('catches up full batches without a polling delay and resumes after the supplied cursor', async () => {
    const requestController = new AbortController()
    const source = {
      watermark: vi.fn().mockResolvedValue('201'),
      readAfter: vi
        .fn()
        .mockResolvedValueOnce({ version: 1, cursor: '200', items: Array.from({ length: 200 }, () => ({})) })
        .mockResolvedValueOnce({ version: 1, cursor: '201', items: [{}] })
        .mockResolvedValue({ version: 1, cursor: '201', items: [] })
    }
    const response = createJobEventStreamResponse(
      new Request('http://localhost/api/jobs/events', { signal: requestController.signal }),
      source as never,
      '5'
    )
    const reader = response.body!.getReader()

    await reader.read() // jobs.ready
    await reader.read() // first full batch
    await reader.read() // immediate catch-up batch
    expect(source.readAfter).toHaveBeenNthCalledWith(1, '5', 200)
    expect(source.readAfter).toHaveBeenNthCalledWith(2, '200', 200)

    requestController.abort()
    await reader.cancel()
  })

  it('sends a heartbeat after fifteen seconds without job events', async () => {
    vi.useFakeTimers()
    const requestController = new AbortController()
    const source = {
      watermark: vi.fn().mockResolvedValue('0'),
      readAfter: vi.fn().mockResolvedValue({ version: 1, cursor: '0', items: [] })
    }
    const response = createJobEventStreamResponse(
      new Request('http://localhost/api/jobs/events', { signal: requestController.signal }),
      source,
      null
    )
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    expect(decoder.decode((await reader.read()).value)).toContain('event: jobs.ready')
    const heartbeat = reader.read()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(decoder.decode((await heartbeat).value)).toContain('event: ping')

    requestController.abort()
    await reader.cancel()
  })
})
