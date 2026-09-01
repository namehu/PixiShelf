import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JobEventStreamItem } from '@pixishelf/job-contracts'

const mocks = vi.hoisted(() => ({ fetchEventSource: vi.fn() }))

vi.mock('@microsoft/fetch-event-source', () => ({ fetchEventSource: mocks.fetchEventSource }))

import { BackgroundJobEventProvider, mergeRecentEvents, useBackgroundJobEvents } from '../background-job-event-provider'

describe('BackgroundJobEventProvider', () => {
  afterEach(() => vi.clearAllMocks())

  it('keeps one connection while descendants rerender and aborts it on unmount', () => {
    mocks.fetchEventSource.mockReturnValue(new Promise(() => undefined))
    const view = render(
      <BackgroundJobEventProvider>
        <span>first page</span>
      </BackgroundJobEventProvider>
    )
    const options = mocks.fetchEventSource.mock.calls[0]?.[1]

    view.rerender(
      <BackgroundJobEventProvider>
        <span>second page</span>
      </BackgroundJobEventProvider>
    )
    expect(mocks.fetchEventSource).toHaveBeenCalledOnce()
    expect(options.signal.aborted).toBe(false)
    view.unmount()
    expect(options.signal.aborted).toBe(true)
  })

  it('deduplicates by global cursor and retains only the newest 500 events', () => {
    const events = Array.from({ length: 501 }, (_, index) => streamItem(String(index + 1)))
    const merged = mergeRecentEvents([streamItem('250')], events)

    expect(merged).toHaveLength(500)
    expect(merged[0]?.event.id).toBe('2')
    expect(merged.at(-1)?.event.id).toBe('501')
    expect(merged.filter((item) => item.event.id === '250')).toHaveLength(1)
  })

  it('publishes every ready boundary so consumers can reconcile their snapshots', async () => {
    mocks.fetchEventSource.mockReturnValue(new Promise(() => undefined))
    render(
      <BackgroundJobEventProvider>
        <ConnectionVersionProbe />
      </BackgroundJobEventProvider>
    )
    const options = mocks.fetchEventSource.mock.calls[0]?.[1]

    act(() => options.onmessage({ data: '0', event: 'jobs.ready', id: '', retry: undefined }))
    await waitFor(() => expect(screen.getByTestId('versions').textContent).toBe('ready:1 reset:0'))

    act(() => {
      options.onmessage({ data: '{}', event: 'jobs.reset', id: '', retry: undefined })
      options.onmessage({ data: '0', event: 'jobs.ready', id: '', retry: undefined })
    })
    await waitFor(() => expect(screen.getByTestId('versions').textContent).toBe('ready:2 reset:1'))
  })
})

function ConnectionVersionProbe() {
  const stream = useBackgroundJobEvents()
  return (
    <span data-testid="versions">
      ready:{stream.readyVersion} reset:{stream.resetVersion}
    </span>
  )
}

function streamItem(id: string): JobEventStreamItem {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    event: {
      id,
      jobId: 'job-1',
      type: 'job.progress',
      level: 'INFO',
      attempt: 1,
      workerId: null,
      stage: null,
      progress: 1,
      message: null,
      data: null,
      createdAt: timestamp
    },
    job: {
      id: 'job-1',
      type: 'SCAN',
      executionLane: 'BACKGROUND_WRITER',
      status: 'RUNNING',
      progress: 1,
      stage: null,
      message: null,
      errorCode: null,
      attempt: 1,
      parentJobId: null,
      heartbeatAt: timestamp,
      startedAt: timestamp,
      finishedAt: null,
      updatedAt: timestamp
    }
  }
}
