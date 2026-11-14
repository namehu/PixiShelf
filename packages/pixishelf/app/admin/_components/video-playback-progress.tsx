'use client'

import { useEffect, useState } from 'react'
import {
  VIDEO_PLAYBACK_PROGRESS_STAGE_VALUES,
  type JobDto,
  type VideoPlaybackProgressStage
} from '@pixishelf/job-contracts'
import { cn } from '@/lib/utils'

const labels: Record<VideoPlaybackProgressStage, string> = {
  PREPARING: '准备',
  PROBING: '原片探测',
  ENCODING: '转码与封装',
  VALIDATING: '输出校验',
  PUBLISHING: '发布'
}
type Job = Pick<JobDto, 'status' | 'progressData' | 'createdAt' | 'startedAt' | 'finishedAt' | 'updatedAt'>

export function VideoPlaybackProgress({
  job,
  compact = false,
  className
}: {
  job: Job
  compact?: boolean
  className?: string
}) {
  const snapshot = job.progressData?.kind === 'video-playback' ? job.progressData : null
  const [clock, setClock] = useState(() => Date.now())
  const running = job.status === 'RUNNING'
  useEffect(() => {
    if (!running || !snapshot) return
    const timer = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [running, snapshot])

  if (compact && (!snapshot || job.status === 'PENDING' || job.status === 'RETRY_WAIT')) return null
  const stale = !!snapshot && running && clock - Date.parse(snapshot.sampledAt) >= 10_000
  const encoding = snapshot?.stage === 'ENCODING'
  const showEta = running && encoding && !stale
  const sampledEnd = snapshot?.sampledAt ?? job.updatedAt
  const stopped = !['RUNNING', 'PAUSING', 'CANCELLING'].includes(job.status)
  const end = job.finishedAt ?? (stopped ? job.updatedAt : sampledEnd)
  const elapsed = (start: string, finish: string) =>
    formatDuration(Math.max(0, Date.parse(finish) - Date.parse(start)) / 1000)

  return (
    <div className={cn('flex min-w-0 flex-col gap-2 text-xs text-muted-foreground', className)}>
      {snapshot && (
        <dl className="flex flex-wrap gap-x-5 gap-y-1 tabular-nums">
          <div>
            <dt className="inline">
              {job.status === 'COMPLETED' ? '平均转码速度' : running && encoding ? '转码速度' : '最近转码速度'}：
            </dt>
            <dd className="inline font-medium text-foreground">
              {stale
                ? '暂未更新'
                : snapshot.speed === null
                  ? running && encoding
                    ? '采样中'
                    : '未采集'
                  : `${snapshot.speed.toFixed(2)}×`}
              {!stale && snapshot.fps !== null ? ` · ${snapshot.fps.toFixed(1)} fps` : ''}
            </dd>
          </div>
          {showEta && (
            <div>
              <dt className="inline">预计编码剩余：</dt>
              <dd className="inline font-medium text-foreground">
                {snapshot.etaSeconds === null
                  ? '采样中'
                  : snapshot.etaSeconds === 0
                    ? '编码接近完成，等待收尾'
                    : `约 ${formatDuration(snapshot.etaSeconds)}`}
              </dd>
            </div>
          )}
        </dl>
      )}
      {stale && <p>进度暂未更新，剩余时间估算已暂停。</p>}
      {!compact && (
        <>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-2 tabular-nums sm:grid-cols-3">
            <div>
              <dt>首次排队</dt>
              <dd className="text-foreground">{job.startedAt ? elapsed(job.createdAt, job.startedAt) : '等待执行'}</dd>
            </div>
            {snapshot
              ? VIDEO_PLAYBACK_PROGRESS_STAGE_VALUES.map((stage) => {
                  const timing = snapshot.stages.find((entry) => entry.stage === stage)
                  const active = timing && !timing.finishedAt && !stopped
                  return (
                    <div key={stage}>
                      <dt>
                        {labels[stage]}
                        {active ? '（进行中）' : ''}
                      </dt>
                      <dd className="text-foreground">
                        {timing ? elapsed(timing.startedAt, timing.finishedAt ?? end) : '未执行'}
                      </dd>
                    </div>
                  )
                })
              : null}
            {job.startedAt && (
              <div>
                <dt>{snapshot ? '本次执行耗时' : '执行耗时'}</dt>
                <dd className="text-foreground">{elapsed(snapshot?.stages[0]?.startedAt ?? job.startedAt, end)}</dd>
              </div>
            )}
          </dl>
          <p>
            {snapshot
              ? '1× 表示每秒处理 1 秒视频。剩余时间仅估算编码；封装收尾、校验和发布另计。运行中耗时截至最近采样。'
              : job.status === 'PENDING' || job.status === 'RETRY_WAIT'
                ? '任务开始后将显示转码指标和各阶段耗时。'
                : running
                  ? '正在等待首次转码指标。'
                  : '这次执行未记录转码速度和分阶段耗时；升级后新执行的任务会显示这些指标。'}
          </p>
        </>
      )}
    </div>
  )
}

function formatDuration(seconds: number) {
  if (seconds < 1) return `${seconds.toFixed(2)} 秒`
  const whole = Math.round(seconds)
  if (whole < 60) return `${whole} 秒`
  if (whole < 3600) return `${Math.floor(whole / 60)} 分 ${whole % 60} 秒`
  return `${Math.floor(whole / 3600)} 小时 ${Math.floor((whole % 3600) / 60)} 分 ${whole % 60} 秒`
}
