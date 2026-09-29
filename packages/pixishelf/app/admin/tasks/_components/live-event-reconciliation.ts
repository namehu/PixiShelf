import type { JobEventStreamItem, JobLiveSummary, JobType } from '@pixishelf/job-contracts'

export interface LiveEventCursor {
  resetVersion: number
  eventId: string | null
}

export function mergeLiveJobSnapshot<T extends { id?: string; updatedAt?: string }>(
  snapshot: T,
  live: JobLiveSummary | undefined
): T {
  if (!live || snapshot.id !== live.id) return snapshot
  // Retained SSE items can predate a refetch, especially during disconnection.
  // Equal timestamps also keep the full query snapshot authoritative.
  if (snapshot.updatedAt && Date.parse(live.updatedAt) <= Date.parse(snapshot.updatedAt)) return snapshot
  return { ...snapshot, ...live }
}

export function collectUnseenLiveEvents(
  items: JobEventStreamItem[],
  resetVersion: number,
  previous: LiveEventCursor
): { items: JobEventStreamItem[]; cursor: LiveEventCursor } {
  const eventId = previous.resetVersion === resetVersion ? previous.eventId : null
  const unseen = items.filter((item) => eventId === null || BigInt(item.event.id) > BigInt(eventId))
  return {
    items: unseen,
    cursor: { resetVersion, eventId: unseen.at(-1)?.event.id ?? eventId }
  }
}

export function selectLiveJobForStatusCache(
  items: JobEventStreamItem[],
  jobType: JobType,
  expectedJobId?: string
): { job: JobLiveSummary | null; sawDifferentJob: boolean } {
  const jobs = items.filter(({ job }) => job.type === jobType).map(({ job }) => job)
  if (jobs.length === 0) return { job: null, sawDifferentJob: false }
  if (!expectedJobId) return { job: jobs.at(-1)!, sawDifferentJob: false }
  return {
    job: [...jobs].reverse().find((job) => job.id === expectedJobId) ?? null,
    sawDifferentJob: jobs.some((job) => job.id !== expectedJobId)
  }
}
