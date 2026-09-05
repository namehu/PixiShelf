import type { JobEventStreamItem, JobLiveSummary, JobStatus, JobType } from '@pixishelf/job-contracts'
import { describe, expect, it } from 'vitest'
import {
  collectUnseenLiveEvents,
  mergeLiveJobSnapshot,
  selectLiveJobForStatusCache
} from '../live-event-reconciliation'

describe('live event reconciliation', () => {
  it.each(['2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z'])(
    'does not overwrite a full query snapshot with a live snapshot dated %s',
    (timestamp) => {
      const snapshot = {
        ...liveJob('job-a', 'WEBP_ANIMATION_SCAN', 'COMPLETED', '2026-01-01T00:01:00.000Z'),
        result: { processed: 42 }
      }
      expect(mergeLiveJobSnapshot(snapshot, liveJob('job-a', 'WEBP_ANIMATION_SCAN', 'RUNNING', timestamp))).toBe(
        snapshot
      )
    }
  )

  it('applies a newer live snapshot while keeping fields omitted by SSE', () => {
    const snapshot = {
      ...liveJob('job-a', 'WEBP_ANIMATION_SCAN', 'RUNNING', '2026-01-01T00:00:00.000Z'),
      payload: {},
      result: null
    }
    const live = liveJob('job-a', 'WEBP_ANIMATION_SCAN', 'PAUSED', '2026-01-01T00:01:00.000Z')
    expect(mergeLiveJobSnapshot(snapshot, live)).toEqual({ ...snapshot, ...live })
    expect(mergeLiveJobSnapshot(snapshot, { ...live, id: 'job-b' })).toBe(snapshot)
  })

  it('starts a new cursor epoch after reset even when event ids move backwards', () => {
    const beforeReset = collectUnseenLiveEvents([streamItem('100', 'job-a')], 0, {
      resetVersion: 0,
      eventId: null
    })
    const afterReset = collectUnseenLiveEvents([streamItem('51', 'job-b')], 1, beforeReset.cursor)

    expect(afterReset.items.map(({ event }) => event.id)).toEqual(['51'])
    expect(afterReset.cursor).toEqual({ resetVersion: 1, eventId: '51' })
  })

  it('patches only the expected job id when the same type has overlapping events', () => {
    const items = [streamItem('10', 'old-job'), streamItem('11', 'new-job')]

    expect(selectLiveJobForStatusCache(items, 'WEBP_ANIMATION_SCAN', 'new-job')).toEqual({
      job: expect.objectContaining({ id: 'new-job' }),
      sawDifferentJob: true
    })
    expect(selectLiveJobForStatusCache([items[0]!], 'WEBP_ANIMATION_SCAN', 'new-job')).toEqual({
      job: null,
      sawDifferentJob: true
    })
  })
})

function streamItem(id: string, jobId: string): JobEventStreamItem {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    event: {
      id,
      jobId,
      type: 'job.progress',
      level: 'INFO',
      attempt: 1,
      workerId: 'worker-a',
      stage: 'SCANNING',
      progress: 20,
      message: null,
      data: null,
      createdAt: timestamp
    },
    job: liveJob(jobId, 'WEBP_ANIMATION_SCAN', 'RUNNING', timestamp)
  }
}

function liveJob(id: string, type: JobType, status: JobStatus, timestamp: string): JobLiveSummary {
  return {
    id,
    type,
    executionLane: 'BACKGROUND_WRITER',
    status,
    progress: 20,
    progressData: null,
    stage: 'SCANNING',
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
