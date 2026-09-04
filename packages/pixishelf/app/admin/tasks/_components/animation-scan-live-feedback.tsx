'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { JobView } from './task-ui'
import { ACTIVE_TASK_STATUSES } from './task-status'

export function AnimationScanLiveFeedback({
  job,
  className
}: {
  job: JobView | null | undefined
  className?: string
}) {
  const progressData = job?.progressData?.kind === 'animation-scan' ? job.progressData : null
  const [clock, setClock] = useState(() => Date.now())

  useEffect(() => {
    if (!progressData || !job || !ACTIVE_TASK_STATUSES.includes(job.status)) {
      return
    }
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [job, progressData])

  if (!progressData) return null
  const sampleAgeSeconds = Math.max(0, Math.floor((clock - Date.parse(progressData.sampledAt)) / 1_000))
  const isPaused = job?.status === 'PAUSED' || job?.status === 'PAUSING' || job?.status === 'RETRY_WAIT'
  const isActive = Boolean(job && ACTIVE_TASK_STATUSES.includes(job.status))
  const isStalled = isActive && !isPaused && sampleAgeSeconds >= 6
  const showEta =
    job?.status === 'RUNNING' && progressData.stage === 'SCANNING' && !isStalled && progressData.etaSeconds !== null

  return (
    <div className={cn('flex flex-col gap-2 text-xs text-muted-foreground', className)}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <AnimationMetric label="已尝试" value={`${progressData.attemptedItems} / ${progressData.totalItems}`} />
        <AnimationMetric label="动图" value={progressData.animatedItems} />
        <AnimationMetric label="静态" value={progressData.staticItems} />
        <AnimationMetric label="失败" value={progressData.failedItems} destructive={progressData.failedItems > 0} />
        <AnimationMetric label="活动探测" value={`${progressData.activeProbes} / ${progressData.concurrencyLimit}`} />
        <AnimationMetric label="速率" value={`${progressData.itemsPerSecond.toFixed(1)} items/s`} />
        <AnimationMetric label="剩余" value={progressData.remainingItems} />
        <AnimationMetric label="预计剩余" value={showEta ? formatDuration(progressData.etaSeconds!) : '采样中'} />
      </div>
      <p className={isStalled ? 'font-medium text-warning' : undefined}>
        {progressData.stage === 'INITIALIZING'
          ? `正在初始化，已完成 ${progressData.initializedItems} 个候选；最近存活更新在 ${sampleAgeSeconds} 秒前`
          : isPaused
            ? `任务已暂停；最近存活更新在 ${sampleAgeSeconds} 秒前`
            : isStalled
              ? `探测暂未推进；最近存活更新在 ${sampleAgeSeconds} 秒前`
              : `最近存活更新在 ${sampleAgeSeconds} 秒前`}
      </p>
    </div>
  )
}

function AnimationMetric({
  label,
  value,
  destructive = false
}: {
  label: string
  value: string | number
  destructive?: boolean
}) {
  return (
    <span>
      {label}：
      <strong className={destructive ? 'font-medium text-destructive' : 'font-medium text-foreground'}>{value}</strong>
    </span>
  )
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`
  if (seconds < 3_600) return `${Math.ceil(seconds / 60)} 分钟`
  return `${Math.ceil(seconds / 3_600)} 小时`
}
