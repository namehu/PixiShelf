import { bigintStringSchema } from '@pixishelf/job-contracts'
import { ApiError } from '@/lib/api-handler'
import {
  JOB_EVENT_STREAM_BATCH_LIMIT,
  PostgresJobEventStreamSource,
  type JobEventStreamSource
} from '@/services/background-task/job-event-stream-service'
import { requireAdminRequest } from '@/services/background-task/request-auth'

export const dynamic = 'force-dynamic'

const encoder = new TextEncoder()
const POLL_INTERVAL_MS = 500
const HEARTBEAT_INTERVAL_MS = 15_000

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdminRequest(request)
  } catch (error) {
    if (error instanceof ApiError || isApiError(error)) {
      return Response.json({ error: error.message }, { status: error.statusCode })
    }
    throw error
  }

  const url = new URL(request.url)
  const requestedCursor = url.searchParams.get('afterEventId') ?? request.headers.get('last-event-id')
  if (requestedCursor !== null && !bigintStringSchema.safeParse(requestedCursor).success) {
    return Response.json({ error: 'Invalid event cursor' }, { status: 400 })
  }

  return createJobEventStreamResponse(request, new PostgresJobEventStreamSource(), requestedCursor)
}

function isApiError(error: unknown): error is { message: string; statusCode: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string' &&
    'statusCode' in error &&
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
  )
}

export function createJobEventStreamResponse(
  request: Request,
  source: JobEventStreamSource,
  requestedCursor: string | null
): Response {
  const connection = new AbortController()
  const abort = () => connection.abort(request.signal.reason)
  if (request.signal.aborted) abort()
  else request.signal.addEventListener('abort', abort, { once: true })

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void runEventLoop(controller, source, requestedCursor, connection.signal).finally(() => {
        request.signal.removeEventListener('abort', abort)
      })
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
  signal: AbortSignal
): Promise<void> {
  try {
    const watermark = await source.watermark()
    let cursor = requestedCursor ?? watermark
    if (BigInt(cursor) > BigInt(watermark)) {
      cursor = watermark
      enqueue(controller, 'jobs.reset', { version: 1, cursor, reason: 'CURSOR_AHEAD' }, cursor)
    }
    enqueue(controller, 'jobs.ready', { version: 1, cursor }, cursor)
    let lastHeartbeatAt = Date.now()

    while (!signal.aborted) {
      const batch = await source.readAfter(cursor, JOB_EVENT_STREAM_BATCH_LIMIT)
      if (batch.items.length > 0) {
        cursor = batch.cursor
        enqueue(controller, 'jobs.events', batch, cursor)
        if (batch.items.length === JOB_EVENT_STREAM_BATCH_LIMIT) continue
      }
      const now = Date.now()
      if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        enqueue(controller, 'ping', { sampledAt: new Date(now).toISOString() })
        lastHeartbeatAt = now
      }
      await abortableDelay(POLL_INTERVAL_MS, signal)
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
