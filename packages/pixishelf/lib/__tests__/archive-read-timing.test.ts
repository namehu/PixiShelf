// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { measureArchiveReadPhase, withArchiveReadTiming } from '../archive-read-timing'

const logs = vi.hoisted(() => ({ info: vi.fn() }))
vi.mock('@/lib/logger', () => ({ default: logs }))

beforeEach(() => logs.info.mockClear())
afterEach(() => vi.restoreAllMocks())

describe('archive read diagnostics', () => {
  it('correlates the response with phase timings without logging request data', async () => {
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const request = new Request('http://localhost/api/trpc/archive.listTasks?input=private-search', {
      headers: { cookie: 'private-cookie', 'x-request-id': 'private-client-id' }
    })
    const response = await withArchiveReadTiming(request, async () => {
      await measureArchiveReadPhase('session', () => {
        clock = 12
      })
      await measureArchiveReadPhase('tasks.records', () => {
        clock = 112
      })
      return measureArchiveReadPhase('tasks.serialize', () => {
        clock = 118
        return Response.json({ items: [] })
      })
    })

    const requestId = response.headers.get('x-request-id')
    expect(requestId).toMatch(/^[a-f0-9-]{36}$/)
    expect(logs.info).toHaveBeenCalledExactlyOnceWith('archive.read-timing', {
      requestId,
      operations: ['archive.listTasks'],
      status: 200,
      success: true,
      durationMs: 118,
      phases: [
        { phase: 'session', startedAfterMs: 0, durationMs: 12, success: true },
        { phase: 'tasks.records', startedAfterMs: 12, durationMs: 100, success: true },
        { phase: 'tasks.serialize', startedAfterMs: 112, durationMs: 6, success: true }
      ]
    })
    expect(JSON.stringify(logs.info.mock.calls)).not.toContain('private-')
    expect(await response.json()).toEqual({ items: [] })
  })

  it('keeps overlapping requests in separate timing contexts', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = withArchiveReadTiming(new Request('http://localhost/api/trpc/archive.listTasks'), async () => {
      await measureArchiveReadPhase('tasks.records', () => pending)
      return Response.json({})
    })
    const second = await withArchiveReadTiming(
      new Request('http://localhost/api/trpc/job.backgroundDashboard'),
      async () => {
        await measureArchiveReadPhase('dashboard.workers', () => [])
        return Response.json({})
      }
    )
    expect(logs.info).toHaveBeenCalledTimes(1)
    release()
    const firstResponse = await first
    const entries = logs.info.mock.calls.map((call) => call[1])
    expect(entries.map((entry) => entry.operations)).toEqual([['job.backgroundDashboard'], ['archive.listTasks']])
    expect(entries.map((entry) => entry.phases.map((phase: { phase: string }) => phase.phase))).toEqual([
      ['dashboard.workers'],
      ['tasks.records']
    ])
    expect(firstResponse.headers.get('x-request-id')).not.toBe(second.headers.get('x-request-id'))
  })

  it('records failed phases and HTTP failures without changing or logging the error', async () => {
    const error = new Error('private-db-url private-source-path')
    const response = await withArchiveReadTiming(
      new Request('http://localhost/api/trpc/archiveInbox.summary'),
      async () => {
        await expect(measureArchiveReadPhase('summary.statusCounts', () => Promise.reject(error))).rejects.toBe(error)
        return new Response(null, { status: 500 })
      }
    )
    expect(response.status).toBe(500)
    expect(logs.info).toHaveBeenLastCalledWith(
      'archive.read-timing',
      expect.objectContaining({
        status: 500,
        success: false,
        phases: [expect.objectContaining({ phase: 'summary.statusCounts', success: false })]
      })
    )
    expect(JSON.stringify(logs.info.mock.calls)).not.toContain('private-')
  })

  it('leaves other endpoints outside the timing scope', async () => {
    const response = await withArchiveReadTiming(new Request('http://localhost/api/trpc/artwork.list'), async () => {
      expect(await measureArchiveReadPhase('session', () => 'unchanged')).toBe('unchanged')
      return Response.json({})
    })
    expect(response.headers.has('x-request-id')).toBe(false)
    expect(logs.info).not.toHaveBeenCalled()
  })
})
