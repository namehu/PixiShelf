'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  archiveTransferTelemetrySchema,
  type ArchiveTransferTelemetry,
  type JobEventStreamItem
} from '@pixishelf/job-contracts'
import { useBackgroundJobEventSubscription } from '../../_components/background-job-event-provider'

export interface LatestArchiveJobEvent {
  item: JobEventStreamItem
  transfer: ArchiveTransferTelemetry | null
}

export function useArchiveLiveEvents(detailSystemJobId?: string) {
  const stream = useBackgroundJobEventSubscription({ jobType: 'ARCHIVE_IMPORT' })
  const realtimeConnected = stream.status === 'connected'
  const liveJobById = useMemo(() => latestArchiveJobs(stream.items), [stream.items])
  const [liveNow, setLiveNow] = useState(() => Date.now())
  const [lifecycleVersion, setLifecycleVersion] = useState(0)
  const [detailRefreshVersion, setDetailRefreshVersion] = useState(0)
  const lastHandledEventId = useRef('0')
  const detailCountSignature = useRef<string | null>(null)

  useEffect(() => {
    lastHandledEventId.current = '0'
    detailCountSignature.current = null
  }, [stream.resetVersion])

  useEffect(() => {
    if (!realtimeConnected || ![...liveJobById.values()].some((value) => value.transfer)) return
    const timer = setInterval(() => setLiveNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [liveJobById, realtimeConnected])

  useEffect(() => {
    let lifecycleChanged = false
    let detailChanged = false
    let latestCursor = lastHandledEventId.current
    for (const item of stream.items) {
      if (BigInt(item.event.id) <= BigInt(lastHandledEventId.current)) continue
      if (BigInt(item.event.id) > BigInt(latestCursor)) latestCursor = item.event.id
      if (isArchiveLifecycleEvent(item.event.type)) {
        lifecycleChanged = true
        if (detailSystemJobId === item.job.id) detailChanged = true
      }
      const transfer = archiveTransferFromEvent(item)
      if (transfer && detailSystemJobId === item.job.id) {
        const signature = `${transfer.completedItems}:${transfer.failedItems}:${item.job.status}`
        if (detailCountSignature.current !== signature) {
          detailCountSignature.current = signature
          detailChanged = true
        }
      }
    }
    lastHandledEventId.current = latestCursor
    if (lifecycleChanged) setLifecycleVersion((value) => value + 1)
    if (detailChanged) setDetailRefreshVersion((value) => value + 1)
  }, [detailSystemJobId, stream.items, stream.resetVersion])

  useEffect(() => {
    if (stream.readyVersion > 0 && detailSystemJobId) {
      setDetailRefreshVersion((value) => value + 1)
    }
  }, [detailSystemJobId, stream.readyVersion])

  return {
    realtimeConnected,
    liveJobById,
    liveNow,
    lifecycleVersion,
    detailRefreshVersion,
    readyVersion: stream.readyVersion,
    resetVersion: stream.resetVersion
  }
}

export function latestArchiveJobs(items: JobEventStreamItem[]): Map<string, LatestArchiveJobEvent> {
  const latest = new Map<string, LatestArchiveJobEvent>()
  for (const item of items) {
    const previous = latest.get(item.job.id)
    const isCurrentAttempt = item.event.attempt === item.job.attempt
    const previousIsCurrentAttempt =
      previous?.item.event.attempt === item.job.attempt && previous.item.job.attempt === item.job.attempt
    latest.set(item.job.id, {
      item,
      transfer:
        ARCHIVE_TRANSFER_ACTIVE_STATUSES.has(item.job.status) && isCurrentAttempt
          ? (archiveTransferFromEvent(item) ?? (previousIsCurrentAttempt ? previous.transfer : null))
          : null
    })
  }
  return latest
}

function archiveTransferFromEvent(item: JobEventStreamItem): ArchiveTransferTelemetry | null {
  const eventData = item.event.data
  const candidate =
    eventData && typeof eventData === 'object' && !Array.isArray(eventData) && 'data' in eventData
      ? eventData.data
      : eventData
  const parsed = archiveTransferTelemetrySchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

function isArchiveLifecycleEvent(type: string): boolean {
  return ARCHIVE_LIFECYCLE_EVENTS.has(type)
}

const ARCHIVE_LIFECYCLE_EVENTS = new Set([
  'job.queued',
  'job.claimed',
  'job.started',
  'job.retry_scheduled',
  'job.pause_requested',
  'job.paused',
  'job.cancel_requested',
  'job.cancelled',
  'job.completed',
  'job.failed',
  'job.skipped'
])

const ARCHIVE_TRANSFER_ACTIVE_STATUSES = new Set(['RUNNING', 'PAUSING', 'CANCELLING'])
