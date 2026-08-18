import type { JobDto, JobEventDto, JobStatus } from '@pixishelf/job-contracts'
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackgroundJobDetail, useBackgroundJobEvents } from '../use-background-dashboard'

interface EventInput {
  jobId: string
  afterEventId?: string
  limit: number
}

const mocks = vi.hoisted(() => ({
  fetchEvents: vi.fn<(input: EventInput) => Promise<{ items: JobEventDto[]; lastEventId: string | null }>>(),
  fetchDetail: vi.fn<(input: { jobId: string }) => Promise<JobDto | null>>()
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    job: {
      backgroundEvents: {
        queryOptions: (input: EventInput, options: object) => ({
          queryKey: ['background-events', input],
          queryFn: () => mocks.fetchEvents(input),
          ...options
        })
      },
      backgroundDetail: {
        queryOptions: (input: { jobId: string }, options: object) => ({
          queryKey: ['background-detail', input],
          queryFn: () => mocks.fetchDetail(input),
          ...options
        })
      }
    }
  })
}))

function createJob(id: string, status: JobStatus, updatedAt = '2026-08-17T02:00:00.000Z'): JobDto {
  return {
    id,
    type: 'VIDEO_MEDIA_PROBE',
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: 1,
    status,
    triggerSource: 'MANUAL',
    requestedByUserId: null,
    scheduledTaskId: null,
    scheduledForDate: null,
    idempotencyKey: null,
    payload: null,
    progress: status === 'COMPLETED' ? 100 : 30,
    stage: null,
    message: null,
    result: null,
    errorCode: null,
    error: null,
    skipReason: null,
    attempt: 1,
    maxAttempts: 3,
    parentJobId: null,
    queuePriority: 20,
    effectivePriority: 20,
    availableAt: updatedAt,
    deadlineAt: null,
    workerId: status === 'RUNNING' ? 'worker-a' : null,
    leaseToken: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    startedAt: status === 'RUNNING' ? updatedAt : null,
    finishedAt: status === 'COMPLETED' ? updatedAt : null,
    createdAt: '2026-08-17T01:00:00.000Z',
    updatedAt
  }
}

function createEvent(jobId: string, id: number): JobEventDto {
  return {
    id: String(id),
    jobId,
    type: 'job.progress',
    level: 'INFO',
    attempt: 1,
    workerId: 'worker-a',
    stage: 'probe',
    progress: Math.min(id, 100),
    message: `${jobId}-event-${id}`,
    data: null,
    createdAt: '2026-08-17T02:01:00.000Z'
  }
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } }
  })
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

async function flushQueries(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    })
  }
}

describe('background dashboard query hooks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    focusManager.setFocused(true)
    mocks.fetchEvents.mockReset()
    mocks.fetchDetail.mockReset()
  })

  afterEach(() => {
    focusManager.setFocused(undefined)
    vi.useRealTimers()
  })

  it('isolates events and cursors through A → B → A → B, ignoring a late A response', async () => {
    let resolveFirstA!: (value: { items: JobEventDto[]; lastEventId: string | null }) => void
    const firstA = new Promise<{ items: JobEventDto[]; lastEventId: string | null }>((resolve) => {
      resolveFirstA = resolve
    })
    const datasets = { A: [createEvent('A', 1)], B: [createEvent('B', 7)] }
    let firstARequest = true
    let poisonedFirstBResponse = true
    mocks.fetchEvents.mockImplementation(async (input) => {
      if (input.jobId === 'A' && firstARequest) {
        firstARequest = false
        return firstA
      }
      if (input.jobId === 'B' && poisonedFirstBResponse) {
        poisonedFirstBResponse = false
        return { items: datasets.A, lastEventId: '1' }
      }
      const items = datasets[input.jobId as 'A' | 'B'].filter(
        (event) => !input.afterEventId || BigInt(event.id) > BigInt(input.afterEventId)
      )
      return { items, lastEventId: items.at(-1)?.id ?? input.afterEventId ?? null }
    })

    const { result, rerender } = renderHook(({ job }) => useBackgroundJobEvents(job), {
      initialProps: { job: createJob('A', 'RUNNING') },
      wrapper: createWrapper()
    })
    await flushQueries(2)

    rerender({ job: createJob('B', 'RUNNING') })
    expect(result.current.events).toEqual([])
    await flushQueries()
    expect(result.current.events).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_501)
    })
    await flushQueries()
    expect(result.current.events.map((event) => `${event.jobId}:${event.id}`)).toEqual(['B:7'])
    expect(
      mocks.fetchEvents.mock.calls
        .filter(([input]) => input.jobId === 'B')
        .slice(0, 2)
        .every(([input]) => input.afterEventId === undefined)
    ).toBe(true)

    resolveFirstA({ items: datasets.A, lastEventId: '1' })
    await flushQueries()
    expect(result.current.events.map((event) => event.jobId)).toEqual(['B'])

    rerender({ job: createJob('A', 'RUNNING') })
    await flushQueries()
    expect(result.current.events.map((event) => `${event.jobId}:${event.id}`)).toEqual(['A:1'])
    expect(mocks.fetchEvents.mock.calls.some(([input]) => input.jobId === 'A' && input.afterEventId === '1')).toBe(true)

    rerender({ job: createJob('B', 'RUNNING') })
    expect(result.current.events.map((event) => event.jobId)).toEqual(['B'])
    await flushQueries()
    expect(
      mocks.fetchEvents.mock.calls
        .filter(([input]) => input.jobId === 'B')
        .every(([input]) => input.afterEventId === undefined || input.afterEventId === '7')
    ).toBe(true)
  })

  it('drains more than 100 terminal events to an empty page, resumes after failure, and then stops', async () => {
    const events = Array.from({ length: 120 }, (_, index) => createEvent('terminal', index + 1))
    let failSecondPage = true
    mocks.fetchEvents.mockImplementation(async (input) => {
      if (input.afterEventId === '100' && failSecondPage) {
        failSecondPage = false
        throw new Error('temporary event failure')
      }
      const items = events
        .filter((event) => !input.afterEventId || BigInt(event.id) > BigInt(input.afterEventId))
        .slice(0, input.limit)
      return { items, lastEventId: items.at(-1)?.id ?? input.afterEventId ?? null }
    })

    const { result } = renderHook(() => useBackgroundJobEvents(createJob('terminal', 'COMPLETED')), {
      wrapper: createWrapper()
    })
    await flushQueries(12)
    expect(result.current.events).toHaveLength(100)
    expect(result.current.isError).toBe(true)

    await act(async () => {
      await result.current.refetch()
    })
    await flushQueries(12)
    expect(result.current.events).toHaveLength(120)
    expect(result.current.terminalDrainComplete).toBe(true)
    expect(mocks.fetchEvents.mock.calls.some(([input]) => input.afterEventId === '120')).toBe(true)

    const callCount = mocks.fetchEvents.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    await flushQueries()
    expect(mocks.fetchEvents).toHaveBeenCalledTimes(callCount)
  })

  it('performs one final empty-page drain when an already-caught-up active job becomes terminal', async () => {
    let terminalEventAvailable = false
    mocks.fetchEvents.mockImplementation(async (input) => {
      const items = terminalEventAvailable && input.afterEventId === undefined ? [createEvent('transition', 1)] : []
      return { items, lastEventId: items.at(-1)?.id ?? input.afterEventId ?? null }
    })
    const { result, rerender } = renderHook(({ status }) => useBackgroundJobEvents(createJob('transition', status)), {
      initialProps: { status: 'RUNNING' as JobStatus },
      wrapper: createWrapper()
    })
    await flushQueries()
    expect(result.current.events).toEqual([])

    terminalEventAvailable = true
    rerender({ status: 'COMPLETED' })
    await flushQueries(12)
    expect(result.current.events.map((event) => event.id)).toEqual(['1'])
    expect(result.current.terminalDrainComplete).toBe(true)
    expect(mocks.fetchEvents.mock.calls.some(([input]) => input.afterEventId === '1')).toBe(true)

    const callCount = mocks.fetchEvents.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await flushQueries()
    expect(mocks.fetchEvents).toHaveBeenCalledTimes(callCount)
  })

  it('lets a newer terminal dashboard snapshot beat stale running detail and stops polling it', async () => {
    let resolveDetail!: (job: JobDto) => void
    mocks.fetchDetail.mockImplementation(
      () =>
        new Promise<JobDto>((resolve) => {
          resolveDetail = resolve
        })
    )
    const running = createJob('detail-race', 'RUNNING', '2026-08-17T02:00:00.000Z')
    const completed = createJob('detail-race', 'COMPLETED', '2026-08-17T02:01:00.000Z')
    const { result, rerender } = renderHook(({ dashboardJob }) => useBackgroundJobDetail('detail-race', dashboardJob), {
      initialProps: { dashboardJob: running },
      wrapper: createWrapper()
    })
    await flushQueries(2)

    rerender({ dashboardJob: completed })
    expect(result.current.data?.status).toBe('COMPLETED')
    resolveDetail(running)
    await flushQueries()
    expect(result.current.data?.status).toBe('COMPLETED')

    const callCount = mocks.fetchDetail.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await flushQueries()
    expect(mocks.fetchDetail).toHaveBeenCalledTimes(callCount)
  })

  it('polls from detail status itself until detail reaches a terminal state', async () => {
    const running = createJob('detail-self', 'RUNNING', '2026-08-17T02:00:00.000Z')
    const completed = createJob('detail-self', 'COMPLETED', '2026-08-17T02:01:00.000Z')
    mocks.fetchDetail.mockResolvedValueOnce(running).mockResolvedValueOnce(completed)
    const { result } = renderHook(() => useBackgroundJobDetail('detail-self', null), {
      wrapper: createWrapper()
    })
    await flushQueries()
    expect(result.current.data?.status).toBe('RUNNING')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_501)
    })
    await flushQueries()
    expect(result.current.data?.status).toBe('COMPLETED')

    const callCount = mocks.fetchDetail.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await flushQueries()
    expect(mocks.fetchDetail).toHaveBeenCalledTimes(callCount)
  })
})
