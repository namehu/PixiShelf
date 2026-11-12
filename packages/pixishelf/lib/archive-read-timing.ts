import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import logger from '@/lib/logger'

interface ReadTiming {
  startedAt: number
  phases: { phase: string; startedAfterMs: number; durationMs: number; success: boolean }[]
}

const readTiming = new AsyncLocalStorage<ReadTiming>()
const measuredOperations = new Set(['archive.listTasks', 'job.backgroundDashboard', 'archiveInbox.summary'])

export async function measureArchiveReadPhase<T>(phase: string, read: () => T | PromiseLike<T>): Promise<T> {
  const timing = readTiming.getStore()
  if (!timing) return read()

  const startedAt = performance.now()
  let success = false
  try {
    const result = await read()
    success = true
    return result
  } finally {
    timing.phases.push({
      phase,
      startedAfterMs: Math.round(startedAt - timing.startedAt),
      durationMs: Math.round(performance.now() - startedAt),
      success
    })
  }
}

export async function withArchiveReadTiming(request: Request, handle: () => Promise<Response>): Promise<Response> {
  const operations = new URL(request.url).pathname
    .split('/')
    .at(-1)!
    .split(',')
    .filter((operation) => measuredOperations.has(operation))
  if (!operations.length) return handle()

  const requestId = randomUUID()
  const timing: ReadTiming = { startedAt: performance.now(), phases: [] }
  return readTiming.run(timing, async () => {
    let status: number | undefined
    try {
      const response = await handle()
      status = response.status
      response.headers.set('x-request-id', requestId)
      return response
    } finally {
      logger.info('archive.read-timing', {
        requestId,
        operations,
        status,
        success: status !== undefined && status < 400,
        durationMs: Math.round(performance.now() - timing.startedAt),
        phases: timing.phases
      })
    }
  })
}
