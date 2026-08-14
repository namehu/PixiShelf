'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { useVideoKeyframeRetryClock } from '@/hooks/use-video-keyframe-retry-clock'
import { useTRPC } from '@/lib/trpc'
import {
  formatVideoKeyframeError,
  getVideoKeyframeRetryCountdown,
  getVideoKeyframePreviewResult,
  isVideoKeyframePreviewJob,
  shouldPollVideoKeyframeQueue,
  type VideoKeyframeJobView,
  type VideoKeyframeQueueView
} from '@/types/video-keyframe'
import { TaskSection } from './task-ui'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { AdminStatusBadge } from '../../_components/admin-status-badge'
import { confirm } from '@/components/shared/global-confirm'

interface FilterDraft {
  minMinutes: string
  maxMinutes: string
  includePaths: string
  excludePaths: string
  statuses: Array<'MISSING' | 'STALE' | 'FAILED'>
}

const EMPTY_FILTER: FilterDraft = {
  minMinutes: '',
  maxMinutes: '',
  includePaths: '',
  excludePaths: '',
  statuses: ['MISSING', 'STALE', 'FAILED']
}

const PREVIEW_PAGE_SIZE = 20

export function VideoKeyframeSection() {
  const trpc = useTRPC()
  const [pollInterval, setPollInterval] = useState<number | false>(false)
  const [filter, setFilter] = useState<FilterDraft>(EMPTY_FILTER)
  const [previewSelection, setPreviewSelection] = useState<{ jobId: string | null; imageIds: number[] }>({
    jobId: null,
    imageIds: []
  })
  const [previewPage, setPreviewPage] = useState(1)
  const queueQuery = useQuery(trpc.job.getVideoKeyframeQueue.queryOptions(undefined, { refetchInterval: pollInterval }))
  const scheduledTasksQuery = useQuery(trpc.job.listScheduledTasks.queryOptions())
  const queue = queueQuery.data as VideoKeyframeQueueView | undefined
  const scheduledTask = useMemo(
    () => scheduledTasksQuery.data?.find((task) => task.key === 'video_keyframe_generation'),
    [scheduledTasksQuery.data]
  )

  useEffect(() => {
    setPollInterval(shouldPollVideoKeyframeQueue(queue) ? 1000 : false)
  }, [queue])

  useEffect(() => {
    const config = scheduledTask?.config
    if (!config || typeof config !== 'object' || Array.isArray(config)) return
    const value = config as Record<string, unknown>
    setFilter({
      minMinutes: secondsToMinutes(value.minDuration),
      maxMinutes: secondsToMinutes(value.maxDuration),
      includePaths: arrayToLines(value.includePaths),
      excludePaths: arrayToLines(value.excludePaths),
      statuses: normalizeDraftStatuses(value.statuses)
    })
  }, [scheduledTask?.config])

  const normalizedFilter = useMemo(() => toApiFilter(filter), [filter])
  const saveFilter = useMutation(
    trpc.job.updateScheduledTask.mutationOptions({
      onSuccess: () => {
        toast.success('代表帧自动筛选规则已保存')
        void scheduledTasksQuery.refetch()
      },
      onError: (error) => toast.error(`保存失败: ${error.message}`)
    })
  )
  const previewBatch = useMutation(
    trpc.job.startVideoKeyframeBatch.mutationOptions({
      onSuccess: (data) => {
        toast.success(`筛选任务已提交（${data.status}）`)
        setPreviewSelection({ jobId: null, imageIds: [] })
        setPreviewPage(1)
        setPollInterval(1000)
        void queueQuery.refetch()
      },
      onError: (error) => toast.error(`筛选失败: ${error.message}`)
    })
  )
  const enqueueSelection = useMutation(
    trpc.job.startVideoKeyframeBatch.mutationOptions({
      onSuccess: (data) => {
        toast.success(`已确认所选视频，批量任务已提交（${data.status}）`)
        setPreviewSelection({ jobId: null, imageIds: [] })
        setPollInterval(1000)
        void queueQuery.refetch()
      },
      onError: (error) => toast.error(`入队失败: ${error.message}`)
    })
  )
  const control = useMutation(
    trpc.job.controlVideoKeyframe.mutationOptions({
      onSuccess: () => void queueQuery.refetch(),
      onError: (error) => toast.error(`操作失败: ${error.message}`)
    })
  )
  const retry = useMutation(
    trpc.job.retryVideoKeyframe.mutationOptions({
      onSuccess: () => {
        setPollInterval(1000)
        void queueQuery.refetch()
      },
      onError: (error) => toast.error(`重试失败: ${error.message}`)
    })
  )
  const active = queue?.active ?? []
  const recent = queue?.recent ?? []
  const discoveryActive = queue?.discoveryActive ?? []
  const discoveryRecent = queue?.discoveryRecent ?? []
  const previewJobs = useMemo(
    () =>
      [...discoveryActive, ...discoveryRecent]
        .filter(isVideoKeyframePreviewJob)
        .sort((left, right) => new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime()),
    [discoveryActive, discoveryRecent]
  )
  const previewJob = previewJobs[0]
  const otherPreviewJobs = previewJobs.slice(1)
  const previewResult = getVideoKeyframePreviewResult(previewJob)
  const executionDiscoveryActive = discoveryActive.filter((job) => !isVideoKeyframePreviewJob(job))
  const executionDiscoveryRecent = discoveryRecent.filter((job) => !isVideoKeyframePreviewJob(job))
  const previewPageCount = Math.max(1, Math.ceil((previewResult?.candidates.length ?? 0) / PREVIEW_PAGE_SIZE))
  const previewCandidates = previewResult?.candidates.slice(
    (previewPage - 1) * PREVIEW_PAGE_SIZE,
    previewPage * PREVIEW_PAGE_SIZE
  )
  const selectedPreviewIds = previewSelection.jobId === previewJob?.id ? previewSelection.imageIds : []
  const selectedPreviewIdSet = new Set(selectedPreviewIds)
  const allPreviewCandidatesSelected = Boolean(
    previewResult?.candidates.length &&
      previewResult.candidates.every((candidate) => selectedPreviewIdSet.has(candidate.imageId))
  )
  const hasActivePreview = discoveryActive.some(
    (job) => isVideoKeyframePreviewJob(job) && ['PENDING', 'RUNNING'].includes(job.status)
  )
  const previewJobRunning = Boolean(previewJob && ['PENDING', 'RUNNING'].includes(previewJob.status))
  const retryClock = useVideoKeyframeRetryClock([...active, ...discoveryActive])

  useEffect(() => {
    setPreviewPage(1)
  }, [previewJob?.id])

  const runningCount = active.filter((job) => job.status === 'RUNNING').length
  const pendingCount = active.filter((job) => job.status === 'PENDING').length
  const pausedCount = active.filter((job) => ['PAUSING', 'PAUSED'].includes(job.status)).length
  const discoveryCount = discoveryActive.filter((job) => ['PENDING', 'RUNNING'].includes(job.status)).length
  const summary =
    discoveryCount > 0
      ? `${discoveryCount} 项筛选/批量任务进行中`
      : runningCount > 0
        ? `${runningCount} 项生成中 · ${pendingCount} 项等待`
        : pendingCount > 0
          ? `${pendingCount} 项等待生成`
          : `${recent.length} 条近期记录`
  const tone =
    discoveryCount > 0 || runningCount > 0 || pendingCount > 0
      ? 'active'
      : recent[0]?.status === 'FAILED'
        ? 'error'
        : 'idle'

  return (
    <TaskSection
      id="video-keyframes"
      category="持久队列"
      icon={Sparkles}
      title="视频代表帧"
      description="按视频时长生成 6/12/20/30 张 640px WebP 代表帧，支持批量筛选、暂停与断点恢复。"
      summary={summary}
      tone={tone}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2" aria-label="代表帧队列状态">
          <Badge variant="secondary">运行 {runningCount}/1</Badge>
          <Badge variant="outline">筛选/批量 {discoveryCount}</Badge>
          <Badge variant="outline">等待 {pendingCount}</Badge>
          <Badge variant="outline">暂停 {pausedCount}</Badge>
          <Badge variant="outline">
            占用 {active.length}/{queue?.capacity ?? 100}
          </Badge>
          <Badge variant="outline">自动上限 {queue?.automaticCapacity ?? 90}</Badge>
        </div>

        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <div>
            <h5 className="text-sm font-medium">自动任务筛选规则</h5>
            <p className="text-xs text-muted-foreground">留空表示不限制；目录每行一个相对扫描根目录的前缀。</p>
          </div>
          <FieldGroup className="gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="keyframe-min-duration">最小时长（分钟）</FieldLabel>
              <Input
                id="keyframe-min-duration"
                name="keyframe-min-duration"
                type="number"
                inputMode="decimal"
                autoComplete="off"
                min="0"
                value={filter.minMinutes}
                onChange={(event) => setFilter((current) => ({ ...current, minMinutes: event.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="keyframe-max-duration">最大时长（分钟）</FieldLabel>
              <Input
                id="keyframe-max-duration"
                name="keyframe-max-duration"
                type="number"
                inputMode="decimal"
                autoComplete="off"
                min="0"
                value={filter.maxMinutes}
                onChange={(event) => setFilter((current) => ({ ...current, maxMinutes: event.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="keyframe-include-paths">包含目录</FieldLabel>
              <Textarea
                id="keyframe-include-paths"
                name="keyframe-include-paths"
                autoComplete="off"
                rows={3}
                value={filter.includePaths}
                onChange={(event) => setFilter((current) => ({ ...current, includePaths: event.target.value }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="keyframe-exclude-paths">排除目录</FieldLabel>
              <Textarea
                id="keyframe-exclude-paths"
                name="keyframe-exclude-paths"
                autoComplete="off"
                rows={3}
                value={filter.excludePaths}
                onChange={(event) => setFilter((current) => ({ ...current, excludePaths: event.target.value }))}
              />
            </Field>
            </div>
          <FieldSet>
            <FieldLegend variant="label">处理状态</FieldLegend>
            <FieldGroup className="flex-row flex-wrap gap-4">
              {(
                [
                  ['MISSING', '缺失'],
                  ['STALE', '源文件已变化'],
                  ['FAILED', '失败']
                ] as const
              ).map(([value, label]) => (
                <Field key={value} orientation="horizontal" className="w-auto">
                  <Checkbox
                    id={`keyframe-status-${value.toLowerCase()}`}
                    checked={filter.statuses.includes(value)}
                    onCheckedChange={(checked) =>
                      setFilter((current) => ({
                        ...current,
                        statuses: checked
                          ? [...new Set([...current.statuses, value])]
                          : current.statuses.filter((status) => status !== value)
                      }))
                    }
                  />
                  <FieldLabel htmlFor={`keyframe-status-${value.toLowerCase()}`}>{label}</FieldLabel>
                </Field>
              ))}
            </FieldGroup>
          </FieldSet>
          </FieldGroup>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!scheduledTask || saveFilter.isPending}
              onClick={() => scheduledTask && saveFilter.mutate({ key: scheduledTask.key, config: normalizedFilter })}
            >
              保存为自动规则
            </Button>
            <Button
              type="button"
              disabled={previewBatch.isPending || hasActivePreview}
              onClick={() => previewBatch.mutate({ force: false, previewOnly: true, filter: normalizedFilter })}
            >
              <Search data-icon="inline-start" aria-hidden="true" />
              预览待处理视频
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={previewBatch.isPending || hasActivePreview}
              onClick={() => previewBatch.mutate({ force: true, previewOnly: true, filter: normalizedFilter })}
            >
              <ListChecks data-icon="inline-start" aria-hidden="true" />
              预览全部匹配视频
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div>
            <h5 className="text-sm font-medium">手工筛选结果</h5>
            <p className="text-xs text-muted-foreground">预览不会开始生成；勾选确认后，所选视频才会进入队列。</p>
          </div>
          {previewJob && !previewResult ? <KeyframeJobRow job={previewJob} retryClock={retryClock} /> : null}
          {!previewJobRunning && previewResult ? (
            <div className="overflow-hidden rounded-lg border bg-card">
              <div className="flex flex-col gap-3 border-b bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">
                    找到 {previewResult.matched} 个视频 · 已选 {selectedPreviewIds.length} 个
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {previewResult.force ? '包含已生成视频，确认后将强制重建。' : '仅显示缺失、过期或失败的视频。'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={previewResult.candidates.length === 0}
                    onClick={() =>
                      setPreviewSelection({
                        jobId: previewJob?.id ?? null,
                        imageIds: allPreviewCandidatesSelected
                          ? []
                          : previewResult.candidates.map((candidate) => candidate.imageId)
                      })
                    }
                  >
                    {allPreviewCandidatesSelected ? '取消全选' : '全选结果'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={selectedPreviewIds.length === 0 || enqueueSelection.isPending}
                    onClick={() =>
                      enqueueSelection.mutate({
                        imageIds: selectedPreviewIds,
                        force: previewResult.force,
                        previewOnly: false,
                        filter: previewResult.filter
                      })
                    }
                  >
                    <Sparkles data-icon="inline-start" aria-hidden="true" />
                    确认处理 {selectedPreviewIds.length} 个
                  </Button>
                </div>
              </div>
              {previewResult.candidates.length > 0 ? (
                <div className="divide-y">
                  {previewCandidates?.map((candidate) => (
                    <label
                      key={candidate.imageId}
                      className="flex cursor-pointer items-start gap-3 p-4 transition-colors hover:bg-muted/30"
                    >
                      <Checkbox
                        className="mt-0.5"
                        aria-label={`选择媒体 ${candidate.imageId}`}
                        checked={selectedPreviewIdSet.has(candidate.imageId)}
                        onCheckedChange={(checked) =>
                          setPreviewSelection((current) => {
                            const imageIds = current.jobId === previewJob?.id ? current.imageIds : []
                            return {
                              jobId: previewJob?.id ?? null,
                              imageIds: checked
                                ? [...new Set([...imageIds, candidate.imageId])]
                                : imageIds.filter((imageId) => imageId !== candidate.imageId)
                            }
                          })
                        }
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">媒体 #{candidate.imageId}</span>
                          <AdminStatusBadge status={candidate.status}>
                            {formatPreviewStatus(candidate.status)}
                          </AdminStatusBadge>
                          <span className="text-xs text-muted-foreground">
                            {formatVideoDuration(candidate.duration)}
                          </span>
                          {candidate.publishedCount > 0 ? (
                            <span className="text-xs text-muted-foreground">已有 {candidate.publishedCount} 张</span>
                          ) : null}
                        </div>
                        <p className="break-all font-mono text-xs text-muted-foreground">{candidate.path}</p>
                      </div>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="p-5 text-sm text-muted-foreground">没有符合当前规则且需要处理的视频。</p>
              )}
              {previewPageCount > 1 ? (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <span className="text-xs text-muted-foreground">
                    第 {previewPage}/{previewPageCount} 页
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={previewPage <= 1}
                      onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}
                    >
                      <ChevronLeft data-icon="inline-start" aria-hidden="true" />
                      上一页
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={previewPage >= previewPageCount}
                      onClick={() => setPreviewPage((page) => Math.min(previewPageCount, page + 1))}
                    >
                      下一页
                      <ChevronRight data-icon="inline-end" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ) : null}
              {previewResult.previewTruncated ? (
                <p className="border-t px-4 py-3 text-xs text-warning">
                  结果超过 1000 个，本次仅提供前 1000 个供选择。请缩小目录或时长范围后重新预览。
                </p>
              ) : null}
              {previewResult.inaccessible > 0 ? (
                <div className="flex flex-col gap-2 border-t px-4 py-3 text-xs text-warning">
                  <p>{previewResult.inaccessible} 个视频无法读取或探测，未列入候选。</p>
                  {previewResult.failedSamples.length > 0 ? (
                    <ul className="flex flex-col gap-1 font-mono">
                      {previewResult.failedSamples.slice(0, 5).map((sample) => (
                        <li key={`${sample.imageId}-${sample.path}`} className="break-all">
                          #{sample.imageId} {sample.path}：{sample.error}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {!previewJob ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              设置条件后点击“预览”，这里会列出视频；预览本身不会创建生成任务。
            </p>
          ) : null}
          {otherPreviewJobs.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">其他筛选任务</p>
              {otherPreviewJobs.map((job) => (
                <KeyframeJobRow key={job.id} job={job} retryClock={retryClock} />
              ))}
            </div>
          ) : null}
        </section>

        <JobGroup title="批量任务" empty="当前没有批量执行任务">
          {[...executionDiscoveryActive, ...executionDiscoveryRecent].map((job) => (
            <KeyframeJobRow key={job.id} job={job} retryClock={retryClock} />
          ))}
        </JobGroup>
        <JobGroup title="正在生成与等待" empty="当前没有代表帧生成任务">
          {active.map((job) => (
            <KeyframeJobRow
              key={job.id}
              job={job}
              retryClock={retryClock}
              onAction={(action) => {
                if (action !== 'cancel') {
                  control.mutate({ jobId: job.id, action })
                  return
                }
                confirm({
                  title: '取消这个代表帧任务？',
                  description: '当前生成会停止，已经发布的代表帧会保留。',
                  confirmText: '确认取消',
                  variant: 'destructive',
                  onConfirm: () => control.mutate({ jobId: job.id, action })
                })
              }}
            />
          ))}
        </JobGroup>
        <JobGroup title="近期记录" empty="还没有代表帧任务记录">
          {recent.map((job) => (
            <KeyframeJobRow
              key={job.id}
              job={job}
              retryClock={retryClock}
              onRetry={['FAILED', 'CANCELLED'].includes(job.status) ? () => retry.mutate({ jobId: job.id }) : undefined}
            />
          ))}
        </JobGroup>
      </div>
    </TaskSection>
  )
}

function JobGroup({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const present = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <section className="flex flex-col gap-2">
      <h5 className="text-sm font-medium">{title}</h5>
      {present ? (
        <div className="flex flex-col gap-2">{children}</div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  )
}

function KeyframeJobRow({
  job,
  retryClock,
  onAction,
  onRetry
}: {
  job: VideoKeyframeJobView
  retryClock: number
  onAction?: (action: 'pause' | 'resume' | 'cancel') => void
  onRetry?: () => void
}) {
  const active = ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING'].includes(job.status)
  const warning = getJobWarning(job.result)
  const retryCountdown = getVideoKeyframeRetryCountdown(job, retryClock)
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <AdminStatusBadge status={job.status}>{job.message || job.status}</AdminStatusBadge>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {job.type === 'VIDEO_KEYFRAME_DISCOVERY'
              ? '批量发现任务'
              : `媒体 #${job.targetImageId ?? '-'} · ${job.targetPath || '路径未知'}`}
          </p>
          {job.error ? <p className="mt-1 text-xs text-destructive">{formatVideoKeyframeError(job.error)}</p> : null}
          {retryCountdown ? <p className="mt-1 text-xs text-warning">{retryCountdown}</p> : null}
          {warning ? <p className="mt-1 text-xs text-warning">{warning}</p> : null}
          {job.type === 'VIDEO_KEYFRAME_DISCOVERY' ? (
            <p className="mt-1 text-xs text-muted-foreground">{getDiscoverySummary(job.result)}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {onAction && job.status === 'RUNNING' ? (
            <Button size="sm" variant="outline" onClick={() => onAction('pause')}>
              <Pause data-icon="inline-start" aria-hidden="true" />
              暂停
            </Button>
          ) : null}
          {onAction && job.status === 'PAUSED' ? (
            <Button size="sm" variant="outline" onClick={() => onAction('resume')}>
              <Play data-icon="inline-start" aria-hidden="true" />
              恢复
            </Button>
          ) : null}
          {onAction && active ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={job.status === 'CANCELLING'}
              onClick={() => onAction('cancel')}
            >
              <X data-icon="inline-start" aria-hidden="true" />
              取消
            </Button>
          ) : null}
          {onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              重试
            </Button>
          ) : null}
        </div>
      </div>
      {job.status === 'RUNNING' || job.status === 'CANCELLING' ? (
        <div className="flex items-center gap-3">
          <Progress value={job.progress} className="h-2 flex-1" />
          <span className="text-xs">{job.progress}%</span>
        </div>
      ) : null}
    </div>
  )
}

function getJobWarning(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const warning = (result as Record<string, unknown>).warning
  return typeof warning === 'string' && warning ? warning : null
}

function getDiscoverySummary(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '等待扫描结果'
  const value = result as Record<string, unknown>
  if (value.request && typeof value.discovered !== 'number') return '筛选条件已持久化，等待 Worker 扫描'
  if (value.previewOnly === true) {
    return `匹配 ${numberOrZero(value.matched)} · 已是最新 ${numberOrZero(value.current)} · 不可访问 ${numberOrZero(value.inaccessible)}`
  }
  const discovered = numberOrZero(value.discovered)
  const enqueued = numberOrZero(value.enqueued)
  const reused = numberOrZero(value.reused)
  const current = numberOrZero(value.current)
  const inaccessible = numberOrZero(value.inaccessible)
  return `发现 ${discovered} · 新增 ${enqueued} · 复用 ${reused} · 已是最新 ${current} · 不可访问 ${inaccessible}`
}

function formatPreviewStatus(status: 'MISSING' | 'STALE' | 'FAILED' | 'CURRENT') {
  return {
    MISSING: '缺失代表帧',
    STALE: '源文件已变化',
    FAILED: '上次生成失败',
    CURRENT: '已是最新'
  }[status]
}

function formatVideoDuration(duration: number | null) {
  if (duration === null) return '时长未知'
  const totalSeconds = Math.max(0, Math.round(duration))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`
  return `${seconds} 秒`
}

function numberOrZero(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function secondsToMinutes(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value / 60) : ''
}

function arrayToLines(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').join('\n') : ''
}

function toApiFilter(value: FilterDraft): {
  minDuration: number | null
  maxDuration: number | null
  includePaths: string[]
  excludePaths: string[]
  statuses: FilterDraft['statuses']
} {
  return {
    minDuration: parseMinutes(value.minMinutes),
    maxDuration: parseMinutes(value.maxMinutes),
    includePaths: splitLines(value.includePaths),
    excludePaths: splitLines(value.excludePaths),
    statuses: value.statuses.length > 0 ? value.statuses : ['MISSING', 'STALE', 'FAILED']
  }
}

function parseMinutes(value: string) {
  if (!value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 60 : null
}

function splitLines(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ]
}

function normalizeDraftStatuses(value: unknown): FilterDraft['statuses'] {
  const supported: FilterDraft['statuses'] = ['MISSING', 'STALE', 'FAILED']
  if (!Array.isArray(value)) return supported
  const selected = supported.filter((status) => value.includes(status))
  return selected.length > 0 ? selected : supported
}
