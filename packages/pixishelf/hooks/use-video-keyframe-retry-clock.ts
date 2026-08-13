import { useEffect, useState } from 'react'
import type { VideoKeyframeJobView } from '@/types/video-keyframe'

export function useVideoKeyframeRetryClock(jobs: Array<VideoKeyframeJobView | null | undefined>) {
  const [now, setNow] = useState(() => Date.now())
  const futureRetryDeadlines = jobs.flatMap((job) => {
    if (job?.status !== 'PENDING' || !job.availableAt) return []
    const deadline = new Date(job.availableAt).getTime()
    return Number.isFinite(deadline) && deadline > now ? [deadline] : []
  })
  const activeRetryAt = futureRetryDeadlines.length > 0 ? Math.min(...futureRetryDeadlines) : null

  useEffect(() => {
    if (activeRetryAt === null) return
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(interval)
  }, [activeRetryAt])

  return now
}
