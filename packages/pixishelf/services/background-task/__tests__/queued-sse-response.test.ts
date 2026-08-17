import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { queuedSseResponse } from '../queued-sse-response'

describe('queuedSseResponse', () => {
  it('emits only connection and queued events before closing', async () => {
    const response = queuedSseResponse({ jobId: 'job-1', status: 'PENDING' })

    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const body = await response.text()
    expect(body.match(/^event:/gm)).toEqual(['event:', 'event:'])
    expect(body).toContain('event: connection')
    expect(body).toContain('event: queued')
    expect(body).not.toContain('event: complete')
    expect(body).toContain('"success":true')
    expect(body).toContain('"status":"PENDING"')
    expect(body).not.toContain('event: progress')
  })
})
