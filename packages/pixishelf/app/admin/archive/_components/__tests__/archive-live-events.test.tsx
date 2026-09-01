import { renderHook, waitFor } from '@testing-library/react'
import type { JobEventStreamItem } from '@pixishelf/job-contracts'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ subscription: vi.fn() }))

vi.mock('../../../_components/background-job-event-provider', () => ({
  useBackgroundJobEventSubscription: mocks.subscription
}))

import { latestArchiveJobs, useArchiveLiveEvents } from '../archive-live-events'

describe('archive live events', () => {
  it('drops transfer telemetry as soon as the current job reaches a terminal state', () => {
    const latest = latestArchiveJobs([
      streamItem('100', 'job.progress', 'RUNNING', [1, 1], transferTelemetry(8, 0, 10)),
      streamItem('101', 'job.completed', 'COMPLETED', [1, 1], null)
    ])

    expect(latest.get('job-1')?.transfer).toBeNull()
  })

  it('does not carry transfer telemetry from an older attempt into a new attempt', () => {
    const latest = latestArchiveJobs([
      streamItem('100', 'job.progress', 'RUNNING', [1, 2], transferTelemetry(8, 0, 10)),
      streamItem('101', 'job.started', 'RUNNING', [2, 2], null)
    ])

    expect(latest.get('job-1')?.transfer).toBeNull()
    expect(
      latestArchiveJobs([
        ...Array.from(latest.values(), ({ item }) => item),
        streamItem('102', 'job.progress', 'RUNNING', [2, 2], transferTelemetry(1, 0, 10))
      ]).get('job-1')?.transfer?.completedItems
    ).toBe(1)
  })

  it('resets its handled cursor after jobs.reset and accepts lower event IDs', async () => {
    mocks.subscription.mockReturnValue({
      status: 'connected',
      items: [streamItem('100', 'job.started', 'RUNNING', [1, 1], null)],
      readyVersion: 1,
      resetVersion: 0
    })
    const view = renderHook(() => useArchiveLiveEvents())
    await waitFor(() => expect(view.result.current.lifecycleVersion).toBe(1))

    mocks.subscription.mockReturnValue({
      status: 'connected',
      items: [streamItem('51', 'job.completed', 'COMPLETED', [1, 1], null)],
      readyVersion: 2,
      resetVersion: 1
    })
    view.rerender()

    await waitFor(() => expect(view.result.current.lifecycleVersion).toBe(2))
  })
})

function streamItem(
  id: string,
  type: JobEventStreamItem['event']['type'],
  status: JobEventStreamItem['job']['status'],
  attempts: readonly [eventAttempt: number, jobAttempt: number],
  data: JobEventStreamItem['event']['data']
): JobEventStreamItem {
  const timestamp = '2026-01-01T00:00:00.000Z'
  const [eventAttempt, jobAttempt] = attempts
  return {
    event: {
      id,
      jobId: 'job-1',
      type,
      level: 'INFO',
      attempt: eventAttempt,
      workerId: 'worker-1',
      stage: 'DOWNLOADING',
      progress: 80,
      message: null,
      data,
      createdAt: timestamp
    },
    job: {
      id: 'job-1',
      type: 'ARCHIVE_IMPORT',
      executionLane: 'BACKGROUND_WRITER',
      status,
      progress: status === 'COMPLETED' ? 100 : 80,
      stage: 'DOWNLOADING',
      message: null,
      errorCode: null,
      attempt: jobAttempt,
      parentJobId: null,
      heartbeatAt: timestamp,
      startedAt: timestamp,
      finishedAt: status === 'COMPLETED' ? timestamp : null,
      updatedAt: timestamp
    }
  }
}

function transferTelemetry(completedItems: number, failedItems: number, totalItems: number) {
  return {
    version: 1,
    kind: 'archive.transfer',
    archiveImportId: 'archive-1',
    downloadedBytes: '1024',
    bytesPerSecond: 512,
    activeDownloads: 2,
    concurrencyLimit: 2,
    completedItems,
    failedItems,
    totalItems,
    sampledAt: '2026-01-01T00:00:00.000Z'
  } as const
}
