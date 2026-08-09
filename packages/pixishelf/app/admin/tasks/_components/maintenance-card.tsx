'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Progress } from '@/components/ui/progress'
import { Loader2, Clock, CheckCircle2, XCircle, Activity, PlayCircle } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

interface MediaDerivedTagSyncStats {
  expectedArtworks?: number
  addedRelations?: number
  removedStaleRelations?: number
  finalRelations?: number
}

interface MediaDerivedTagSyncResult {
  webp?: MediaDerivedTagSyncStats
  video?: MediaDerivedTagSyncStats
  image?: MediaDerivedTagSyncStats
}

interface WebpAnimationScanFailedSample {
  id: number
  path: string
  error: string
}

interface WebpAnimationScanResult {
  initialized?: number
  processed?: number
  animated?: number
  static?: number
  failed?: number
  remainingPending?: number
  failedSamples?: WebpAnimationScanFailedSample[]
}

interface VideoMediaProbeFailedSample {
  imageId: number
  path: string
  error: string
}

interface VideoMediaProbeResult {
  classifiedVideos?: number
  classifiedImages?: number
  classifiedAnimations?: number
  unknown?: number
  metadataRowsCreated?: number
  processed?: number
  failed?: number
  remainingPending?: number
  failedSamples?: VideoMediaProbeFailedSample[]
  poster?: { processed?: number; generated?: number; failed?: number; orphanedFilesDeleted?: number }
}

interface VideoChapterPreviewResult {
  mode?: 'FULL' | 'INCREMENTAL'
  pending?: number
  processed?: number
  reused?: number
  generated?: number
  failed?: number
  orphanedFilesDeleted?: number
  failedSamples?: Array<{ imageId: number; path: string; chapterOrder: number | null; error: string }>
}

interface ScheduledTaskView {
  key: string
  type: string
  name: string
  description: string
  enabled: boolean
  scheduleMode: string
  time: string
  timezone: string
  priority: number
  mutexKey: string | null
  lastTriggeredAt: string | Date | null
  lastTriggeredDate: string | null
  lastJobId: string | null
  lastJobStatus: string | null
  nextRunAt: string | null
}

interface JobView {
  status: string
  progress: number
  message?: string | null
  error?: string | null
  result?: unknown
}

interface TaskDraft {
  enabled: boolean
  time: string
  priority: string
}

function toMediaDerivedTagSyncResult(result: unknown): MediaDerivedTagSyncResult | null {
  return result && typeof result === 'object' ? (result as MediaDerivedTagSyncResult) : null
}

function toWebpAnimationScanResult(result: unknown): WebpAnimationScanResult | null {
  return result && typeof result === 'object' ? (result as WebpAnimationScanResult) : null
}

function toVideoMediaProbeResult(result: unknown): VideoMediaProbeResult | null {
  return result && typeof result === 'object' ? (result as VideoMediaProbeResult) : null
}

function toVideoChapterPreviewResult(result: unknown): VideoChapterPreviewResult | null {
  return result && typeof result === 'object' ? (result as VideoChapterPreviewResult) : null
}

function isJobVisible(job: JobView | null | undefined, isRunning: boolean) {
  return Boolean(job && (isRunning || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)))
}

function formatDateTime(value: string | Date | null) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  return date.toLocaleString('zh-CN', { hour12: false })
}

function getDraftForTask(task: ScheduledTaskView, drafts: Record<string, TaskDraft>) {
  return (
    drafts[task.key] ?? {
      enabled: task.enabled,
      time: task.time,
      priority: String(task.priority)
    }
  )
}

function TaskSection({
  title,
  description,
  action,
  children
}: {
  title: string
  description: string
  action: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-5 px-6 py-6 transition-colors hover:bg-muted/5 first:pt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h4 className="font-semibold text-foreground tracking-tight">{title}</h4>
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      </div>
      {children && <div className="flex flex-col gap-4">{children}</div>}
    </div>
  )
}

function JobStatus({
  job,
  isRunning,
  completeContent
}: {
  job: JobView | null | undefined
  isRunning: boolean
  completeContent?: ReactNode
}) {
  if (!isJobVisible(job, isRunning)) return null

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : job?.status === 'COMPLETED' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : job?.status === 'FAILED' ? (
              <XCircle className="h-4 w-4 text-destructive" />
            ) : (
              <Activity className="h-4 w-4 text-muted-foreground" />
            )}
            <span>状态: {job?.status}</span>
            {job?.message && (
              <span className="text-muted-foreground font-normal hidden sm:inline"> - {job.message}</span>
            )}
          </div>
          <span className="font-medium text-muted-foreground">{job?.progress ?? 0}%</span>
        </div>
        {job?.message && <p className="text-muted-foreground text-sm sm:hidden">{job.message}</p>}
        <Progress value={job?.progress ?? 0} className="h-2" />
        {job?.error && <p className="text-sm text-destructive font-medium mt-2">错误: {job.error}</p>}
      </div>
      {job?.status === 'COMPLETED' && completeContent && (
        <div className="border-t bg-muted/20 px-4 py-3 text-sm">{completeContent}</div>
      )}
      {job?.status === 'COMPLETED' && !completeContent && (
        <div className="border-t bg-muted/20 px-4 py-3 text-sm text-emerald-600 font-medium">任务完成</div>
      )}
      {job?.status === 'CANCELLED' && (
        <div className="border-t bg-muted/20 px-4 py-3 text-sm text-muted-foreground">任务已取消</div>
      )}
    </div>
  )
}

function ScheduleSettings({
  task,
  draft,
  onDraftChange,
  onSave,
  isSaving
}: {
  task: ScheduledTaskView
  draft: TaskDraft
  onDraftChange: (patch: Partial<TaskDraft>) => void
  onSave: () => void
  isSaving: boolean
}) {
  const priority = Number(draft.priority)
  const priorityInvalid = draft.priority.trim() === '' || Number.isNaN(priority)
  const changed = draft.enabled !== task.enabled || draft.time !== task.time || priority !== task.priority

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm overflow-hidden">
      <div className="bg-muted/30 px-4 py-3 border-b flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h5 className="text-sm font-medium">定时计划配置</h5>
      </div>
      <div className="p-4 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
          <div className="space-y-1">
            <span className="text-muted-foreground text-xs">执行模式</span>
            <p className="font-medium text-foreground">{task.scheduleMode === 'DAILY' ? '每日' : task.scheduleMode}</p>
          </div>
          <div className="space-y-1">
            <span className="text-muted-foreground text-xs">时区</span>
            <p className="font-medium text-foreground">{task.timezone}</p>
          </div>
          <div className="space-y-1">
            <span className="text-muted-foreground text-xs">下次计划执行</span>
            <p className="font-medium text-foreground">{task.nextRunAt || '-'}</p>
          </div>
          <div className="space-y-1">
            <span className="text-muted-foreground text-xs">上次触发时间</span>
            <p className="font-medium text-foreground">{formatDateTime(task.lastTriggeredAt)}</p>
          </div>
          {task.mutexKey && (
            <div className="space-y-1">
              <span className="text-muted-foreground text-xs">互斥组</span>
              <p className="font-medium text-foreground">{task.mutexKey}</p>
            </div>
          )}
          <div className="space-y-1">
            <span className="text-muted-foreground text-xs">上次自动日期</span>
            <p className="font-medium text-foreground">{task.lastTriggeredDate || '-'}</p>
          </div>
          <div className="space-y-1">
            <span className="text-muted-foreground text-xs">最近任务状态</span>
            <p className="font-medium text-foreground">{task.lastJobStatus || '-'}</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-4 border-t border-dashed">
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 shrink-0">
            <Switch checked={draft.enabled} onCheckedChange={(checked) => onDraftChange({ enabled: checked })} />
            <span className="text-sm font-medium min-w-[3rem]">{draft.enabled ? '已启用' : '已停用'}</span>
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">时间</span>
              <Input
                type="time"
                value={draft.time}
                onChange={(event) => onDraftChange({ time: event.target.value })}
                className="h-9 w-[120px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">优先级</span>
              <Input
                type="number"
                min={0}
                max={1000}
                value={draft.priority}
                onChange={(event) => onDraftChange({ priority: event.target.value })}
                className="h-9 w-[90px]"
                title="优先级，数字越小越先执行"
              />
            </div>
          </div>
          <Button
            variant={changed ? 'default' : 'outline'}
            size="sm"
            onClick={onSave}
            disabled={isSaving || !changed || priorityInvalid}
            className="shrink-0 h-9"
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存计划
          </Button>
        </div>
      </div>
    </div>
  )
}

export function MaintenanceCard() {
  const trpc = useTRPC()
  const [pollInterval, setPollInterval] = useState<number | false>(false)
  const [mediaTagPollInterval, setMediaTagPollInterval] = useState<number | false>(false)
  const [webpScanPollInterval, setWebpScanPollInterval] = useState<number | false>(false)
  const [videoProbePollInterval, setVideoProbePollInterval] = useState<number | false>(false)
  const [chapterPreviewPollInterval, setChapterPreviewPollInterval] = useState<number | false>(false)
  const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskDraft>>({})
  const [triggeringTaskKey, setTriggeringTaskKey] = useState<string | null>(null)
  const [videoReprobePath, setVideoReprobePath] = useState('')

  const { data: activeJob, refetch } = useQuery(
    trpc.job.getRefillMetaSourceStatus.queryOptions(undefined, {
      refetchInterval: pollInterval
    })
  )

  const mediaTagJobQuery = useQuery(
    trpc.job.getMediaDerivedTagSyncStatus.queryOptions(undefined, {
      refetchInterval: mediaTagPollInterval
    })
  )
  const mediaTagJob = mediaTagJobQuery.data as JobView | null | undefined
  const refetchMediaTagJob = mediaTagJobQuery.refetch

  const webpScanJobQuery = useQuery(
    trpc.job.getWebpAnimationScanStatus.queryOptions(undefined, {
      refetchInterval: webpScanPollInterval
    })
  )
  const webpScanJob = webpScanJobQuery.data as JobView | null | undefined
  const refetchWebpScanJob = webpScanJobQuery.refetch

  const videoProbeJobQuery = useQuery(
    trpc.job.getVideoMediaProbeStatus.queryOptions(undefined, {
      refetchInterval: videoProbePollInterval
    })
  )
  const videoProbeJob = videoProbeJobQuery.data as JobView | null | undefined
  const refetchVideoProbeJob = videoProbeJobQuery.refetch

  const chapterPreviewJobQuery = useQuery(
    trpc.job.getVideoChapterPreviewGenerationStatus.queryOptions(undefined, {
      refetchInterval: chapterPreviewPollInterval
    })
  )
  const chapterPreviewJob = chapterPreviewJobQuery.data as JobView | null | undefined
  const refetchChapterPreviewJob = chapterPreviewJobQuery.refetch

  const scheduledTasksQuery = useQuery(trpc.job.listScheduledTasks.queryOptions())
  const scheduledTasks = (scheduledTasksQuery.data ?? []) as ScheduledTaskView[]
  const refetchScheduledTasks = scheduledTasksQuery.refetch

  const scheduledTasksByKey = useMemo(() => {
    return new Map(scheduledTasks.map((task) => [task.key, task]))
  }, [scheduledTasks])

  const webpScheduledTask = scheduledTasksByKey.get('webp_animation_scan')
  const videoScheduledTask = scheduledTasksByKey.get('video_media_probe')
  const chapterPreviewScheduledTask = scheduledTasksByKey.get('video_chapter_preview_generation')
  const standaloneScheduledTasks = scheduledTasks.filter(
    (task) => !['webp_animation_scan', 'video_media_probe', 'video_chapter_preview_generation'].includes(task.key)
  )

  useEffect(() => {
    if (activeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(activeJob.status)) {
      setPollInterval(1000)
    } else {
      setPollInterval(false)
    }
  }, [activeJob?.status])

  useEffect(() => {
    if (mediaTagJob && ['PENDING', 'RUNNING'].includes(mediaTagJob.status)) {
      setMediaTagPollInterval(1000)
    } else {
      setMediaTagPollInterval(false)
    }
  }, [mediaTagJob?.status])

  useEffect(() => {
    if (webpScanJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(webpScanJob.status)) {
      setWebpScanPollInterval(1000)
    } else {
      setWebpScanPollInterval(false)
    }
  }, [webpScanJob?.status])

  useEffect(() => {
    if (videoProbeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(videoProbeJob.status)) {
      setVideoProbePollInterval(1000)
    } else {
      setVideoProbePollInterval(false)
    }
  }, [videoProbeJob?.status])

  useEffect(() => {
    if (chapterPreviewJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(chapterPreviewJob.status)) {
      setChapterPreviewPollInterval(1000)
    } else {
      setChapterPreviewPollInterval(false)
    }
  }, [chapterPreviewJob?.status])

  useEffect(() => {
    if (scheduledTasks.length === 0) return

    setTaskDrafts((prev) => {
      const next = { ...prev }
      for (const task of scheduledTasks) {
        if (!next[task.key]) {
          next[task.key] = {
            enabled: task.enabled,
            time: task.time,
            priority: String(task.priority)
          }
        }
      }
      return next
    })
  }, [scheduledTasks])

  const startMutation = useMutation(
    trpc.job.startRefillMetaSource.mutationOptions({
      onSuccess: () => {
        toast.success('元数据补全任务已启动')
        refetch()
      },
      onError: (error) => {
        toast.error(`启动失败: ${error.message}`)
      }
    })
  )

  const cancelMutation = useMutation(
    trpc.job.cancelRefillMetaSource.mutationOptions({
      onSuccess: () => {
        toast.info('正在取消任务...')
        refetch()
      }
    })
  )

  const startMediaTagMutation = useMutation(
    trpc.job.startMediaDerivedTagSync.mutationOptions({
      onSuccess: () => {
        toast.success('媒体标签同步任务已启动')
        refetchMediaTagJob()
      },
      onError: (error) => {
        toast.error(`启动失败: ${error.message}`)
      }
    })
  )

  const cancelVideoProbeMutation = useMutation(
    trpc.job.cancelVideoMediaProbe.mutationOptions({
      onSuccess: () => {
        toast.info('正在取消视频媒体探测任务...')
        refetchVideoProbeJob()
      },
      onError: (error) => {
        toast.error(`取消失败: ${error.message}`)
      }
    })
  )

  const cancelChapterPreviewMutation = useMutation(
    trpc.job.cancelVideoChapterPreviewGeneration.mutationOptions({
      onSuccess: () => {
        toast.info('正在取消章节截图任务...')
        refetchChapterPreviewJob()
      },
      onError: (error) => {
        toast.error(`取消失败: ${error.message}`)
      }
    })
  )

  const reprobeVideoByPathMutation = useMutation(
    trpc.job.reprobeVideoMediaByPath.mutationOptions({
      onSuccess: (result) => {
        toast.success(`视频重新探测完成：${result.hasAudio ? '有音频' : '无音频'}，状态 ${result.probeStatus}`)
        setVideoReprobePath('')
        refetchVideoProbeJob()
      },
      onError: (error) => {
        toast.error(`重新探测失败: ${error.message}`)
      }
    })
  )

  const updateScheduledTaskMutation = useMutation(
    trpc.job.updateScheduledTask.mutationOptions({
      onSuccess: () => {
        toast.success('计划任务已保存')
        refetchScheduledTasks()
      },
      onError: (error) => {
        toast.error(`保存失败: ${error.message}`)
      }
    })
  )

  const triggerScheduledTaskMutation = useMutation(
    trpc.job.triggerScheduledTaskNow.mutationOptions({
      onSuccess: (_data, variables) => {
        toast.success(
          variables.chapterPreviewMode === 'INCREMENTAL'
            ? '章节截图增量任务已启动'
            : variables.chapterPreviewMode === 'FULL'
              ? '章节截图全量任务已启动'
              : '计划任务已手动触发'
        )
        refetchScheduledTasks()
        refetchWebpScanJob()
        refetchVideoProbeJob()
        refetchChapterPreviewJob()
      },
      onError: (error) => {
        toast.error(`触发失败: ${error.message}`)
      },
      onSettled: () => {
        setTriggeringTaskKey(null)
      }
    })
  )

  const isRunning = activeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(activeJob.status)
  const isCancelling = activeJob?.status === 'CANCELLING'
  const isMediaTagRunning = mediaTagJob && ['PENDING', 'RUNNING'].includes(mediaTagJob.status)
  const isWebpScanRunning = webpScanJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(webpScanJob.status)
  const isVideoProbeRunning = videoProbeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(videoProbeJob.status)
  const isVideoProbeCancelling = videoProbeJob?.status === 'CANCELLING'
  const isChapterPreviewRunning =
    chapterPreviewJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(chapterPreviewJob.status)
  const isChapterPreviewCancelling = chapterPreviewJob?.status === 'CANCELLING'
  const mediaTagResult = toMediaDerivedTagSyncResult(mediaTagJob?.result)
  const webpScanResult = toWebpAnimationScanResult(webpScanJob?.result)
  const videoProbeResult = toVideoMediaProbeResult(videoProbeJob?.result)
  const chapterPreviewResult = toVideoChapterPreviewResult(chapterPreviewJob?.result)

  const updateTaskDraft = (key: string, patch: Partial<TaskDraft>) => {
    setTaskDrafts((prev) => ({
      ...prev,
      [key]: {
        enabled: false,
        time: '03:30',
        priority: '100',
        ...prev[key],
        ...patch
      }
    }))
  }

  const handleSaveScheduledTask = (task: ScheduledTaskView) => {
    const draft = taskDrafts[task.key]
    if (!draft) return

    updateScheduledTaskMutation.mutate({
      key: task.key,
      enabled: draft.enabled,
      time: draft.time,
      priority: Number(draft.priority)
    })
  }

  const handleTriggerScheduledTask = (task: ScheduledTaskView, chapterPreviewMode?: 'FULL' | 'INCREMENTAL') => {
    setTriggeringTaskKey(chapterPreviewMode ? `${task.key}:${chapterPreviewMode}` : task.key)
    triggerScheduledTaskMutation.mutate({ key: task.key, chapterPreviewMode })
  }

  const renderScheduleSettings = (task: ScheduledTaskView) => {
    const draft = getDraftForTask(task, taskDrafts)

    return (
      <ScheduleSettings
        task={task}
        draft={draft}
        onDraftChange={(patch) => updateTaskDraft(task.key, patch)}
        onSave={() => handleSaveScheduledTask(task)}
        isSaving={updateScheduledTaskMutation.isPending}
      />
    )
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b bg-muted/10 px-6 py-5">
        <CardTitle>数据修正</CardTitle>
        <CardDescription>按任务集中管理手动执行、执行进度和定时计划</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border p-0">
        <TaskSection
          title="补全元数据源 (MetaSource)"
          description="递归扫描目录，根据文件名补全数据库中缺失的 metaSource 字段。"
          action={
            isRunning ? (
              <Button
                variant="destructive"
                onClick={() => cancelMutation.mutate()}
                disabled={Boolean(isCancelling) || cancelMutation.isPending}
              >
                {isCancelling ? '正在取消...' : '取消任务'}
              </Button>
            ) : (
              <Button onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
                {startMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="mr-2 h-4 w-4" />
                )}
                开始补全
              </Button>
            )
          }
        >
          <JobStatus job={activeJob} isRunning={Boolean(isRunning)} />
        </TaskSection>

        <TaskSection
          title="同步媒体标签"
          description="根据作品媒体文件后缀，同步 image、video、webp 系统标签，并移除过期关联。"
          action={
            <Button
              onClick={() => startMediaTagMutation.mutate()}
              disabled={Boolean(isMediaTagRunning) || startMediaTagMutation.isPending}
            >
              {startMediaTagMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="mr-2 h-4 w-4" />
              )}
              {isMediaTagRunning ? '同步中...' : '开始同步'}
            </Button>
          }
        >
          <JobStatus
            job={mediaTagJob}
            isRunning={Boolean(isMediaTagRunning)}
            completeContent={
              <div className="text-muted-foreground space-y-1">
                <p>
                  <span className="font-medium text-foreground">任务完成：</span>
                  image <strong className="text-foreground">{mediaTagResult?.image?.finalRelations ?? 0}</strong> 个，
                  video <strong className="text-foreground">{mediaTagResult?.video?.finalRelations ?? 0}</strong> 个，
                  webp <strong className="text-foreground">{mediaTagResult?.webp?.finalRelations ?? 0}</strong> 个。
                </p>
                <p>
                  本次新增{' '}
                  <strong className="text-foreground">
                    {(mediaTagResult?.image?.addedRelations ?? 0) +
                      (mediaTagResult?.video?.addedRelations ?? 0) +
                      (mediaTagResult?.webp?.addedRelations ?? 0)}
                  </strong>{' '}
                  个关联， 移除{' '}
                  <strong className="text-foreground">
                    {(mediaTagResult?.image?.removedStaleRelations ?? 0) +
                      (mediaTagResult?.video?.removedStaleRelations ?? 0) +
                      (mediaTagResult?.webp?.removedStaleRelations ?? 0)}
                  </strong>{' '}
                  个过期关联。
                </p>
              </div>
            }
          />
        </TaskSection>

        <TaskSection
          title={webpScheduledTask?.name ?? '识别图片动画'}
          description={
            webpScheduledTask?.description ?? '按内容识别 WebP、GIF、PNG/APNG 的静态或动画类型，并纠正 mediaType。'
          }
          action={
            <Button
              onClick={() => webpScheduledTask && handleTriggerScheduledTask(webpScheduledTask)}
              disabled={!webpScheduledTask || Boolean(isWebpScanRunning) || triggerScheduledTaskMutation.isPending}
            >
              {triggeringTaskKey === webpScheduledTask?.key ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="mr-2 h-4 w-4" />
              )}
              {isWebpScanRunning ? '识别中...' : '立即执行'}
            </Button>
          }
        >
          <JobStatus
            job={webpScanJob}
            isRunning={Boolean(isWebpScanRunning)}
            completeContent={
              <div className="space-y-3 text-muted-foreground">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>
                    初始化: <strong className="text-foreground font-medium">{webpScanResult?.initialized ?? 0}</strong>
                  </span>
                  <span>
                    已处理: <strong className="text-foreground font-medium">{webpScanResult?.processed ?? 0}</strong>
                  </span>
                  <span>
                    动图: <strong className="text-foreground font-medium">{webpScanResult?.animated ?? 0}</strong>
                  </span>
                  <span>
                    静态: <strong className="text-foreground font-medium">{webpScanResult?.static ?? 0}</strong>
                  </span>
                  <span>
                    失败: <strong className="text-destructive font-medium">{webpScanResult?.failed ?? 0}</strong>
                  </span>
                  <span>
                    剩余待处理:{' '}
                    <strong className="text-foreground font-medium">{webpScanResult?.remainingPending ?? 0}</strong>
                  </span>
                </div>
                {webpScanResult?.failedSamples && webpScanResult.failedSamples.length > 0 && (
                  <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive">
                    <p className="font-medium mb-2 text-sm">失败样例</p>
                    <ul className="space-y-1 text-xs font-mono">
                      {webpScanResult.failedSamples.slice(0, 5).map((sample) => (
                        <li key={sample.id} className="break-all">
                          <span className="opacity-70">
                            #{sample.id} {sample.path}:
                          </span>{' '}
                          {sample.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            }
          />
          {webpScheduledTask && renderScheduleSettings(webpScheduledTask)}
        </TaskSection>

        <TaskSection
          title={videoScheduledTask?.name ?? '视频媒体探测'}
          description={
            videoScheduledTask?.description ?? '分类未识别媒体，并使用 ffprobe 探测视频音频、编码、时长和帧率。'
          }
          action={
            isVideoProbeRunning ? (
              <Button
                variant="destructive"
                onClick={() => cancelVideoProbeMutation.mutate()}
                disabled={isVideoProbeCancelling || cancelVideoProbeMutation.isPending}
              >
                {isVideoProbeCancelling ? '正在取消...' : '取消任务'}
              </Button>
            ) : (
              <Button
                onClick={() => videoScheduledTask && handleTriggerScheduledTask(videoScheduledTask)}
                disabled={!videoScheduledTask || triggerScheduledTaskMutation.isPending}
              >
                {triggeringTaskKey === videoScheduledTask?.key ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="mr-2 h-4 w-4" />
                )}
                立即执行
              </Button>
            )
          }
        >
          <div className="rounded-lg border border-border bg-muted/10 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <label className="text-sm font-medium text-foreground">按路径重试视频探测</label>
                <p className="text-xs text-muted-foreground">输入数据库相对路径，或 SCAN_PATH 下的绝对路径。</p>
                <Input
                  value={videoReprobePath}
                  onChange={(event) => setVideoReprobePath(event.target.value)}
                  placeholder="/artist/work/video.mp4"
                  className="h-9 bg-background mt-2"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && videoReprobePath.trim() && !reprobeVideoByPathMutation.isPending) {
                      reprobeVideoByPathMutation.mutate({ path: videoReprobePath })
                    }
                  }}
                />
              </div>
              <Button
                variant="secondary"
                onClick={() => reprobeVideoByPathMutation.mutate({ path: videoReprobePath })}
                disabled={!videoReprobePath.trim() || reprobeVideoByPathMutation.isPending}
                className="h-9 shrink-0 w-full sm:w-auto"
              >
                {reprobeVideoByPathMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                重试探测
              </Button>
            </div>
          </div>

          <JobStatus
            job={videoProbeJob}
            isRunning={Boolean(isVideoProbeRunning)}
            completeContent={
              <div className="space-y-3 text-muted-foreground">
                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-foreground">本次新分类 UNKNOWN 媒体：</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>
                      视频:{' '}
                      <strong className="text-foreground font-medium">{videoProbeResult?.classifiedVideos ?? 0}</strong>
                    </span>
                    <span>
                      图片:{' '}
                      <strong className="text-foreground font-medium">{videoProbeResult?.classifiedImages ?? 0}</strong>
                    </span>
                    <span>
                      动图:{' '}
                      <strong className="text-foreground font-medium">
                        {videoProbeResult?.classifiedAnimations ?? 0}
                      </strong>
                    </span>
                    <span>
                      仍未知: <strong className="text-foreground font-medium">{videoProbeResult?.unknown ?? 0}</strong>
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5 border-t border-border/50 pt-2">
                  <p className="text-sm font-medium text-foreground">探测与处理进度：</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>
                      新建 metadata:{' '}
                      <strong className="text-foreground font-medium">
                        {videoProbeResult?.metadataRowsCreated ?? 0}
                      </strong>{' '}
                      行
                    </span>
                    <span>
                      成功: <strong className="text-foreground font-medium">{videoProbeResult?.processed ?? 0}</strong>
                    </span>
                    <span>
                      失败: <strong className="text-destructive font-medium">{videoProbeResult?.failed ?? 0}</strong>
                    </span>
                    <span>
                      剩余待探测:{' '}
                      <strong className="text-foreground font-medium">{videoProbeResult?.remainingPending ?? 0}</strong>
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5 border-t border-border/50 pt-2">
                  <p className="text-sm font-medium text-foreground">视频封面处理：</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>
                      处理:{' '}
                      <strong className="text-foreground font-medium">
                        {videoProbeResult?.poster?.processed ?? 0}
                      </strong>
                    </span>
                    <span>
                      生成:{' '}
                      <strong className="text-foreground font-medium">
                        {videoProbeResult?.poster?.generated ?? 0}
                      </strong>
                    </span>
                    <span>
                      失败:{' '}
                      <strong className="text-destructive font-medium">{videoProbeResult?.poster?.failed ?? 0}</strong>
                    </span>
                    <span>
                      清理孤儿文件:{' '}
                      <strong className="text-foreground font-medium">
                        {videoProbeResult?.poster?.orphanedFilesDeleted ?? 0}
                      </strong>
                    </span>
                  </div>
                </div>
                {videoProbeResult?.failedSamples && videoProbeResult.failedSamples.length > 0 && (
                  <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive mt-2">
                    <p className="font-medium mb-2 text-sm">失败样例</p>
                    <ul className="space-y-1 text-xs font-mono">
                      {videoProbeResult.failedSamples.slice(0, 5).map((sample) => (
                        <li key={sample.imageId} className="break-all">
                          <span className="opacity-70">
                            #{sample.imageId} {sample.path}:
                          </span>{' '}
                          {sample.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            }
          />
          {videoScheduledTask && renderScheduleSettings(videoScheduledTask)}
        </TaskSection>

        <TaskSection
          title={chapterPreviewScheduledTask?.name ?? '生成视频章节截图'}
          description={
            chapterPreviewScheduledTask?.description ?? '每日增量补齐缺失章节截图，也可手动执行全量校验与重新生成。'
          }
          action={
            isChapterPreviewRunning ? (
              <Button
                variant="destructive"
                onClick={() => cancelChapterPreviewMutation.mutate()}
                disabled={isChapterPreviewCancelling || cancelChapterPreviewMutation.isPending}
              >
                {isChapterPreviewCancelling ? '正在取消...' : '取消任务'}
              </Button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    chapterPreviewScheduledTask &&
                    handleTriggerScheduledTask(chapterPreviewScheduledTask, 'INCREMENTAL')
                  }
                  disabled={!chapterPreviewScheduledTask || triggerScheduledTaskMutation.isPending}
                >
                  {triggeringTaskKey === `${chapterPreviewScheduledTask?.key}:INCREMENTAL` ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PlayCircle className="mr-2 h-4 w-4" />
                  )}
                  增量执行
                </Button>
                <Button
                  onClick={() =>
                    chapterPreviewScheduledTask && handleTriggerScheduledTask(chapterPreviewScheduledTask, 'FULL')
                  }
                  disabled={!chapterPreviewScheduledTask || triggerScheduledTaskMutation.isPending}
                >
                  {triggeringTaskKey === `${chapterPreviewScheduledTask?.key}:FULL` ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <PlayCircle className="mr-2 h-4 w-4" />
                  )}
                  全量执行
                </Button>
              </div>
            )
          }
        >
          <JobStatus
            job={chapterPreviewJob}
            isRunning={Boolean(isChapterPreviewRunning)}
            completeContent={
              <div className="space-y-3 text-muted-foreground">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <span>
                    模式:{' '}
                    <strong className="font-medium text-foreground">
                      {chapterPreviewResult?.mode === 'INCREMENTAL' ? '增量' : '全量'}
                    </strong>
                  </span>
                  <span>
                    待生成:{' '}
                    <strong className="font-medium text-foreground">{chapterPreviewResult?.pending ?? 0}</strong>
                  </span>
                  <span>
                    已处理:{' '}
                    <strong className="font-medium text-foreground">{chapterPreviewResult?.processed ?? 0}</strong>
                  </span>
                  <span>
                    复用: <strong className="font-medium text-foreground">{chapterPreviewResult?.reused ?? 0}</strong>
                  </span>
                  <span>
                    生成:{' '}
                    <strong className="font-medium text-foreground">{chapterPreviewResult?.generated ?? 0}</strong>
                  </span>
                  <span>
                    失败: <strong className="font-medium text-destructive">{chapterPreviewResult?.failed ?? 0}</strong>
                  </span>
                  {chapterPreviewResult?.mode !== 'INCREMENTAL' && (
                    <span>
                      清理孤儿:{' '}
                      <strong className="font-medium text-foreground">
                        {chapterPreviewResult?.orphanedFilesDeleted ?? 0}
                      </strong>
                    </span>
                  )}
                </div>
                {chapterPreviewResult?.failedSamples && chapterPreviewResult.failedSamples.length > 0 && (
                  <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive">
                    <p className="mb-2 text-sm font-medium">失败样例</p>
                    <ul className="space-y-1 text-xs font-mono">
                      {chapterPreviewResult.failedSamples.slice(0, 5).map((sample, index) => (
                        <li
                          key={`${sample.imageId}-${sample.chapterOrder ?? 'manifest'}-${index}`}
                          className="break-all"
                        >
                          <span className="opacity-70">
                            #{sample.imageId}
                            {sample.chapterOrder === null ? '' : ` 章节 ${sample.chapterOrder + 1}`} {sample.path}:
                          </span>{' '}
                          {sample.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            }
          />
          {chapterPreviewScheduledTask && renderScheduleSettings(chapterPreviewScheduledTask)}
        </TaskSection>

        {standaloneScheduledTasks.map((task) => (
          <TaskSection
            key={task.key}
            title={task.name}
            description={task.description}
            action={
              <Button
                onClick={() => handleTriggerScheduledTask(task)}
                disabled={triggerScheduledTaskMutation.isPending}
              >
                {triggeringTaskKey === task.key ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="mr-2 h-4 w-4" />
                )}
                立即执行
              </Button>
            }
          >
            {renderScheduleSettings(task)}
          </TaskSection>
        ))}
      </CardContent>
    </Card>
  )
}
