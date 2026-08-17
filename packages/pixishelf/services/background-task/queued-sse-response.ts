import 'server-only'

import { NextResponse } from 'next/server'

export function queuedSseResponse(queued: unknown) {
  const encoder = new TextEncoder()
  return new NextResponse(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`event: connection\ndata: ${JSON.stringify({ success: true, queued: true })}\n\n`)
        )
        controller.enqueue(encoder.encode(`event: queued\ndata: ${JSON.stringify({ success: true, queued })}\n\n`))
        controller.close()
      }
    }),
    { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } }
  )
}
