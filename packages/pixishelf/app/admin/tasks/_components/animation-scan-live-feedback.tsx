'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { JobView } from './task-ui'
import { ACTIVE_TASK_STATUSES, TERMINAL_TASK_STATUSES } from './task-status'

export function AnimationScanLiveFeedback({ job, className }: { job: JobView | null | undefined; className?: string }) {
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
  const isTerminal = Boolean(job && TERMINAL_TASK_STATUSES.includes(job.status))
  const isStalled = isActive && !isPaused && sampleAgeSeconds >= 6
  const showEta =
    job?.status === 'RUNNING' && progressData.stage === 'SCANNING' && !isStalled && progressData.etaSeconds !== null

  return (
    <div className={cn('flex flex-col gap-2 text-xs text-muted-foreground', className)}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <AnimationMetric label="已尝试" value={`${progressData.attemptedItems} / ${progressData.totalItems}`} />
        <AnimationMetric label="动图" value={progressData.animatedItems} />
        <AnimationMetric label="静态" value={progressData.staticItems} />
        <AnimationMetric label="探测失败" value={progressData.failedItems} destructive={progressData.failedItems > 0} />
        <AnimationMetric label={isTerminal ? '待下次处理' : '剩余待处理'} value={progressData.remainingItems} />
        {!isTerminal && (
          <>
            <AnimationMetric
              label="活动探测"
              value={`${progressData.activeProbes} / ${progressData.concurrencyLimit}`}
            />
            <AnimationMetric label="速率" value={`${progressData.itemsPerSecond.toFixed(1)} items/s`} />
            <AnimationMetric label="预计剩余" value={showEta ? formatDuration(progressData.etaSeconds!) : '采样中'} />
          </>
        )}
      </div>
      <p className={isStalled ? 'font-medium text-warning' : undefined}>
        {isTerminal
          ? job?.status === 'COMPLETED'
            ? progressData.remainingItems > 0
              ? `本轮识别已结束，仍有 ${progressData.remainingItems} 个待处理；再次执行将处理这些项目。`
              : '本轮识别已结束，当前没有待处理图片。'
            : '本轮识别已结束，已提交的结果已保留。'
          : progressData.stage === 'INITIALIZING'
            ? `正在准备候选，已准备 ${progressData.initializedItems} 个；尚未开始内容识别。`
            : isPaused
              ? `任务已暂停；最近进度更新在 ${sampleAgeSeconds} 秒前`
              : isStalled
                ? `探测暂未推进；最近进度更新在 ${sampleAgeSeconds} 秒前`
                : `最近进度更新在 ${sampleAgeSeconds} 秒前`}
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
