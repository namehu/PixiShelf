import {
  JOB_EVENT_STREAM_BATCH_LIMIT,
  getJobEventPollIntervalMs,
  type JobEventStreamSource
} from '@/services/background-task/job-event-stream-service'
import type { AdminRealtimeSource } from '@/services/background-task/admin-realtime-source'

const encoder = new TextEncoder()
const HEARTBEAT_INTERVAL_MS = 15_000

export function createJobEventStreamResponse(
  request: Request,
  source: JobEventStreamSource,
  requestedCursor: string | null,
  realtime?: AdminRealtimeSource
): Response {
  const pollIntervalMs = getJobEventPollIntervalMs()
  const connection = new AbortController()
  const abort = () => connection.abort(request.signal.reason)
  if (request.signal.aborted) abort()
  else request.signal.addEventListener('abort', abort, { once: true })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void runEventLoop(controller, source, requestedCursor, connection.signal, { pollIntervalMs, realtime }).finally(
        () => {
          request.signal.removeEventListener('abort', abort)
        }
      )
    },
    cancel() {
      connection.abort()
      request.signal.removeEventListener('abort', abort)
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  })
}

async function runEventLoop(
  controller: ReadableStreamDefaultController<Uint8Array>,
  source: JobEventStreamSource,
  requestedCursor: string | null,
  signal: AbortSignal,
  { pollIntervalMs, realtime }: { pollIntervalMs: number; realtime?: AdminRealtimeSource }
): Promise<void> {
  try {
    const watermark = await source.watermark()
    // Establish the revision baseline before ready causes clients to load their snapshots.
    await realtime?.readChanges(new Date())
    let cursor = requestedCursor ?? watermark
    if (BigInt(cursor) > BigInt(watermark)) {
      cursor = watermark
      enqueue(controller, 'jobs.reset', { version: 1, cursor, reason: 'CURSOR_AHEAD' }, cursor)
    }
    enqueue(controller, 'jobs.ready', { version: 1, cursor }, cursor)
    let lastHeartbeatAt = Date.now()
    if (realtime) enqueue(controller, 'workers.snapshot', await realtime.readWorkers(new Date()))

    while (!signal.aborted) {
      const resources = await realtime?.readChanges(new Date())
      if (resources?.length) enqueue(controller, 'admin.invalidate', { version: 1, resources })
      const batch = await source.readAfter(cursor, JOB_EVENT_STREAM_BATCH_LIMIT)
      if (batch.items.length > 0) {
        cursor = batch.cursor
        enqueue(controller, 'jobs.events', batch, cursor)
        if (batch.items.length === JOB_EVENT_STREAM_BATCH_LIMIT) continue
      }
      const now = Date.now()
      if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        if (realtime) enqueue(controller, 'workers.snapshot', await realtime.readWorkers(new Date(now)))
        enqueue(controller, 'ping', { sampledAt: new Date(now).toISOString() })
        lastHeartbeatAt = now
      }
      await abortableDelay(pollIntervalMs, signal)
    }
    safeClose(controller)
  } catch (error) {
    if (signal.aborted) {
      safeClose(controller)
      return
    }
    controller.error(error)
  }
}

function safeClose(controller: ReadableStreamDefaultController<Uint8Array>): void {
  try {
    controller.close()
  } catch {
    // cancel() may have already closed the web stream while the database loop was unwinding.
  }
}

function enqueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
  id?: string
): void {
  controller.enqueue(
    encoder.encode(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  )
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(finish, milliseconds)
    function finish() {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    function abort() {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
