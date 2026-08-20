'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Database, Film, ImagePlay, PlayCircle, Tags, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'
import { VideoKeyframeSection } from './video-keyframe-section'
import { VideoStreamingOptimizationSection } from './video-streaming-optimization-section'
import {
  getDraftForTask,
  getScheduledTaskUpdate,
  JobStatus,
  ScheduleSettings,
  TaskAccordion,
  TaskGroup,
  TaskSection,
  type JobView,
  type ScheduledTaskView
} from './task-ui'
import { Spinner } from '@/components/ui/spinner'
import { confirm } from '@/components/shared/global-confirm'
import { BackgroundTaskConsole } from './background-task-console'
import { useScheduledTaskDrafts } from './use-scheduled-task-drafts'
import { useTaskPolling } from './use-task-polling'

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
  stage: 'PROBE' | 'POSTER'
  imageId: number
  path: string
  error: string
}

interface VideoMediaProbeResult {
  classification?: {
    videos?: number
    images?: number
    animations?: number
    unknown?: number
    metadataRowsCreated?: number
  }
  probe?: { total?: number; processed?: number; failed?: number; remaining?: number }
  poster?: {
    total?: number
    processed?: number
    generated?: number
    skipped?: number
    failed?: number
    remaining?: number
  }
  failedSamples?: VideoMediaProbeFailedSample[]
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

function getJobSummary(job: JobView | null | undefined, isRunning: boolean) {
  if (isRunning) return `运行中 · ${job?.progress ?? 0}%`
  if (job?.status === 'FAILED') return '需要处理 · 上次执行失败'
  return null
}

function getJobTone(job: JobView | null | undefined, isRunning: boolean): 'idle' | 'active' | 'success' | 'error' {
  if (isRunning) return 'active'
  if (job?.status === 'FAILED') return 'error'
  return 'idle'
}

function getScheduledSummary(task: ScheduledTaskView | undefined, job: JobView | null | undefined, isRunning: boolean) {
  const jobSummary = getJobSummary(job, isRunning)
  if (jobSummary) return jobSummary
  if (!task?.enabled) return null
  return task.executionWindow ? '下次 · 上海 00:00–08:00' : `下次 · 每日 ${task.time}`
}

function getStandaloneSummary(task: ScheduledTaskView) {
  if (task.lastJobStatus && ['PENDING', 'RUNNING', 'CANCELLING'].includes(task.lastJobStatus)) return '正在运行'
  if (task.lastJobStatus === 'FAILED') return '需要处理 · 上次执行失败'
  if (!task.enabled) return null
  return task.executionWindow ? '下次 · 上海 00:00–08:00' : `下次 · 每日 ${task.time}`
}

export function shouldPollStandaloneTasks(tasks: ScheduledTaskView[] | undefined) {
  return Boolean(
    tasks?.some((task) => task.lastJobStatus && ['PENDING', 'RUNNING', 'CANCELLING'].includes(task.lastJobStatus))
  )
}

export function getStandaloneTaskActionLabel(task: ScheduledTaskView) {
  if (task.key === 'derived_media_gc') return '执行到期清理'
  if (task.key === 'derived_media_gc_reconciliation') return '开始只读核对'
  return '立即执行'
}

export function requestStandaloneTaskTrigger(task: ScheduledTaskView, onTrigger: () => void) {
  if (task.key !== 'derived_media_gc') {
    onTrigger()
    return
  }
  confirm({
    title: '执行到期清理？',
    description: '只会删除无引用且已到期的已登记派生文件；不会扫描或删除未登记文件。',
    confirmText: '执行到期清理',
    variant: 'destructive',
    onConfirm: onTrigger
  })
}

export function StandaloneTaskFeedback({ task }: { task: ScheduledTaskView }) {
  if (!task.lastJobId) return null
  const result = task.lastJobResult
  const status =
    task.lastJobStatus && ['PENDING', 'RUNNING', 'CANCELLING'].includes(task.lastJobStatus)
      ? '运行中'
      : task.lastJobStatus === 'COMPLETED'
        ? '已完成'
        : task.lastJobStatus === 'FAILED'
          ? '失败'
          : task.lastJobStatus === 'CANCELLED'
            ? '已取消'
            : '未知'
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
      <span>
        模式：
        <strong className="font-medium text-foreground">
          {task.lastJobMode === 'PREVIEW' ? '预览（只读）' : '正式执行'}
        </strong>
      </span>
      <span>
        状态：<strong className="font-medium text-foreground">{status}</strong>
      </span>
      {result && task.key === 'trigger_log_retention_cleanup' && (
        <span>
          删除日志：<strong className="font-medium text-foreground">{result?.deletedLogs ?? 0}</strong>
        </span>
      )}
      {result && task.key === 'scan_run_retention_cleanup' && (
        <span>
          删除扫描记录：<strong className="font-medium text-foreground">{result?.deletedRuns ?? 0}</strong>
        </span>
      )}
      {result && task.key === 'archive_intake_retention_cleanup' && (
        <>
          <span>
            删除批量操作：
            <strong className="font-medium text-foreground">{result.deletedBulkOperations ?? 0}</strong>
          </span>
          <span>
            删除收件记录：<strong className="font-medium text-foreground">{result.deletedIntakeItems ?? 0}</strong>
          </span>
          <span>
            删除收件批次：<strong className="font-medium text-foreground">{result.deletedSubmissions ?? 0}</strong>
          </span>
          <span>
            删除过期预览：
            <strong className="font-medium text-foreground">{result.deletedPreviewSessions ?? 0}</strong>
          </span>
        </>
      )}
      {result && task.type === 'DERIVED_MEDIA_GC' && (
        <>
          <span>
            选中：<strong className="font-medium text-foreground">{result?.selected ?? 0}</strong>
          </span>
          <span>
            删除：<strong className="font-medium text-foreground">{result?.deleted ?? 0}</strong>
          </span>
          <span>
            缺失：<strong className="font-medium text-foreground">{result?.missing ?? 0}</strong>
          </span>
          <span>
            仍被引用：<strong className="font-medium text-foreground">{result?.referenced ?? 0}</strong>
          </span>
          <span>
            失败：<strong className="font-medium text-destructive">{result?.failed ?? 0}</strong>
          </span>
          <span>
            核对扫描：<strong className="font-medium text-foreground">{result?.reconciliationScanned ?? 0}</strong>
          </span>
          <span>
            未登记候选：<strong className="font-medium text-foreground">{result?.untrackedCandidates ?? 0}</strong>
          </span>
        </>
      )}
    </div>
  )
}

export function MaintenanceCard() {
  const trpc = useTRPC()
  const [triggeringTaskKey, setTriggeringTaskKey] = useState<string | null>(null)
  const [videoReprobePath, setVideoReprobePath] = useState('')

  const pollRefill = useTaskPolling<JobView | null>((job) =>
    Boolean(job && ['PENDING', 'RUNNING', 'CANCELLING'].includes(job.status))
  )
  const pollMediaTags = useTaskPolling<JobView | null>((job) =>
    Boolean(job && ['PENDING', 'RUNNING'].includes(job.status))
  )
  const pollCancellable = useTaskPolling<JobView | null>((job) =>
    Boolean(job && ['PENDING', 'RUNNING', 'CANCELLING'].includes(job.status))
  )
  const pollScheduledTasks = useTaskPolling<ScheduledTaskView[]>(shouldPollStandaloneTasks)

  const { data: activeJob, refetch } = useQuery(
    trpc.job.getRefillMetaSourceStatus.queryOptions(undefined, {
      refetchInterval: pollRefill
    })
  )

  const mediaTagJobQuery = useQuery(
    trpc.job.getMediaDerivedTagSyncStatus.queryOptions(undefined, {
      refetchInterval: pollMediaTags
    })
  )
  const mediaTagJob = mediaTagJobQuery.data as JobView | null | undefined
  const refetchMediaTagJob = mediaTagJobQuery.refetch

  const webpScanJobQuery = useQuery(
    trpc.job.getWebpAnimationScanStatus.queryOptions(undefined, {
      refetchInterval: pollCancellable
    })
  )
  const webpScanJob = webpScanJobQuery.data as JobView | null | undefined
  const refetchWebpScanJob = webpScanJobQuery.refetch

  const videoProbeJobQuery = useQuery(
    trpc.job.getVideoMediaProbeStatus.queryOptions(undefined, {
      refetchInterval: pollCancellable
    })
  )
  const videoProbeJob = videoProbeJobQuery.data as JobView | null | undefined
  const refetchVideoProbeJob = videoProbeJobQuery.refetch

  const chapterPreviewJobQuery = useQuery(
    trpc.job.getVideoChapterPreviewGenerationStatus.queryOptions(undefined, {
      refetchInterval: pollCancellable
    })
  )
  const chapterPreviewJob = chapterPreviewJobQuery.data as JobView | null | undefined
  const refetchChapterPreviewJob = chapterPreviewJobQuery.refetch

  const scheduledTasksQuery = useQuery(
    trpc.job.listScheduledTasks.queryOptions(undefined, { refetchInterval: pollScheduledTasks })
  )
  const scheduledTasks = (scheduledTasksQuery.data ?? []) as ScheduledTaskView[]
  const { drafts: taskDrafts, updateDraft: updateTaskDraft } = useScheduledTaskDrafts(scheduledTasks)
  const refetchScheduledTasks = scheduledTasksQuery.refetch

  const scheduledTasksByKey = useMemo(() => {
    return new Map(scheduledTasks.map((task) => [task.key, task]))
  }, [scheduledTasks])

  const webpScheduledTask = scheduledTasksByKey.get('webp_animation_scan')
  const videoScheduledTask = scheduledTasksByKey.get('video_media_probe')
  const chapterPreviewScheduledTask = scheduledTasksByKey.get('video_chapter_preview_generation')
  const standaloneScheduledTasks = scheduledTasks.filter(
    (task) =>
      ![
        'webp_animation_scan',
        'video_media_probe',
        'video_chapter_preview_generation',
        'video_keyframe_generation'
      ].includes(task.key)
  )
  const startMutation = useMutation(
    trpc.job.startRefillMetaSource.mutationOptions({
      onSuccess: () => {
        toast.success('元数据补全任务已启动')
        refetch()
      },
      onError: (error) => {
        toast.error(`启动失败：${error.message}`)
      }
    })
  )

  const cancelMutation = useMutation(
    trpc.job.cancelRefillMetaSource.mutationOptions({
      onSuccess: () => {
        toast.info('正在取消任务…')
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
        toast.error(`启动失败：${error.message}`)
      }
    })
  )

  const cancelVideoProbeMutation = useMutation(
    trpc.job.cancelVideoMediaProbe.mutationOptions({
      onSuccess: () => {
        toast.info('正在取消视频媒体探测与封面生成任务…')
        refetchVideoProbeJob()
      },
      onError: (error) => {
        toast.error(`取消失败：${error.message}`)
      }
    })
  )

  const cancelChapterPreviewMutation = useMutation(
    trpc.job.cancelVideoChapterPreviewGeneration.mutationOptions({
      onSuccess: () => {
        toast.info('正在取消章节截图任务…')
        refetchChapterPreviewJob()
      },
      onError: (error) => {
        toast.error(`取消失败：${error.message}`)
      }
    })
  )

  const reprobeVideoByPathMutation = useMutation(
    trpc.job.reprobeVideoMediaByPath.mutationOptions({
      onSuccess: (result) => {
        if (result.mode === 'QUEUED') {
          toast.success(result.reused ? '已复用队列中的视频重探测任务' : '视频重探测任务已加入队列')
        } else {
          toast.success(
            `视频重新探测完成：${result.metadata.hasAudio ? '有音频' : '无音频'}，状态 ${result.metadata.probeStatus}`
          )
        }
        setVideoReprobePath('')
        refetchVideoProbeJob()
      },
      onError: (error) => {
        toast.error(`重新探测失败：${error.message}`)
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
        toast.error(`保存失败：${error.message}`)
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
        toast.error(`触发失败：${error.message}`)
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
  const handleSaveScheduledTask = (task: ScheduledTaskView) => {
    const draft = taskDrafts[task.key]
    if (!draft) return

    updateScheduledTaskMutation.mutate(getScheduledTaskUpdate(task, draft))
  }

  const handleTriggerScheduledTask = (task: ScheduledTaskView, chapterPreviewMode?: 'FULL' | 'INCREMENTAL') => {
    setTriggeringTaskKey(chapterPreviewMode ? `${task.key}:${chapterPreviewMode}` : task.key)
    triggerScheduledTaskMutation.mutate({ key: task.key, chapterPreviewMode })
  }

  const confirmTaskCancellation = (taskName: string, onConfirm: () => void) => {
    confirm({
      title: `取消“${taskName}”？`,
      description: '当前处理会停止，已完成的项目会保留；未完成项目之后可以重新执行。',
      confirmText: '确认取消',
      variant: 'destructive',
      onConfirm
    })
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
    <div className="flex min-w-0 flex-col gap-5">
      {scheduledTasksQuery.isPending ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          <Spinner aria-hidden="true" />
          正在读取自动计划…
        </div>
      ) : null}
      <TaskAccordion>
        <TaskGroup title="图库维护" description="修正作品元数据与标签关系。">
          <TaskSection
            id="meta-source"
            category="手动任务"
            icon={Database}
            title="补全元数据源 (MetaSource)"
            description="递归扫描目录，根据文件名补全数据库中缺失的 metaSource 字段。"
            summary={getJobSummary(activeJob, Boolean(isRunning))}
            tone={getJobTone(activeJob, Boolean(isRunning))}
            action={
              isRunning ? (
                <Button
                  variant="destructive"
                  onClick={() => confirmTaskCancellation('补全元数据源', () => cancelMutation.mutate())}
                  disabled={Boolean(isCancelling) || cancelMutation.isPending}
                >
                  {isCancelling ? '正在取消…' : '取消任务'}
                </Button>
              ) : (
                <Button onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
                  {startMutation.isPending ? (
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                  ) : (
                    <PlayCircle data-icon="inline-start" aria-hidden="true" />
                  )}
                  开始补全
                </Button>
              )
            }
          >
            <JobStatus job={activeJob} isRunning={Boolean(isRunning)} />
          </TaskSection>

          <TaskSection
            id="media-tags"
            category="手动任务"
            icon={Tags}
            title="同步媒体标签"
            description="根据作品媒体文件后缀，同步 image、video、webp 系统标签，并移除过期关联。"
            summary={getJobSummary(mediaTagJob, Boolean(isMediaTagRunning))}
            tone={getJobTone(mediaTagJob, Boolean(isMediaTagRunning))}
            action={
              <Button
                onClick={() => startMediaTagMutation.mutate()}
                disabled={Boolean(isMediaTagRunning) || startMediaTagMutation.isPending}
              >
                {startMediaTagMutation.isPending ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <PlayCircle data-icon="inline-start" aria-hidden="true" />
                )}
                {isMediaTagRunning ? '同步中…' : '开始同步'}
              </Button>
            }
          >
            <JobStatus
              job={mediaTagJob}
              isRunning={Boolean(isMediaTagRunning)}
              completeContent={
                <div className="flex flex-col gap-1 text-muted-foreground">
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
        </TaskGroup>

        <TaskGroup title="媒体处理" description="识别媒体属性、生成预览并管理视频处理队列。">
          <TaskSection
            id="image-animation"
            category="可定时"
            icon={ImagePlay}
            title={webpScheduledTask?.name ?? '识别图片动画'}
            description={
              webpScheduledTask?.description ?? '按内容识别 WebP、GIF、PNG/APNG 的静态或动画类型，并纠正 mediaType。'
            }
            summary={getScheduledSummary(webpScheduledTask, webpScanJob, Boolean(isWebpScanRunning))}
            tone={getJobTone(webpScanJob, Boolean(isWebpScanRunning))}
            action={
              <Button
                onClick={() => webpScheduledTask && handleTriggerScheduledTask(webpScheduledTask)}
                disabled={!webpScheduledTask || Boolean(isWebpScanRunning) || triggerScheduledTaskMutation.isPending}
              >
                {triggeringTaskKey === webpScheduledTask?.key ? (
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <PlayCircle data-icon="inline-start" aria-hidden="true" />
                )}
                {isWebpScanRunning ? '识别中…' : '立即执行'}
              </Button>
            }
          >
            <JobStatus
              job={webpScanJob}
              isRunning={Boolean(isWebpScanRunning)}
              completeContent={
                <div className="flex flex-col gap-3 text-muted-foreground">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>
                      初始化：
                      <strong className="text-foreground font-medium">{webpScanResult?.initialized ?? 0}</strong>
                    </span>
                    <span>
                      已处理：<strong className="text-foreground font-medium">{webpScanResult?.processed ?? 0}</strong>
                    </span>
                    <span>
                      动图：<strong className="text-foreground font-medium">{webpScanResult?.animated ?? 0}</strong>
                    </span>
                    <span>
                      静态：<strong className="text-foreground font-medium">{webpScanResult?.static ?? 0}</strong>
                    </span>
                    <span>
                      失败：<strong className="text-destructive font-medium">{webpScanResult?.failed ?? 0}</strong>
                    </span>
                    <span>
                      剩余待处理：{' '}
                      <strong className="text-foreground font-medium">{webpScanResult?.remainingPending ?? 0}</strong>
                    </span>
                  </div>
                  {webpScanResult?.failedSamples && webpScanResult.failedSamples.length > 0 && (
                    <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive">
                      <p className="font-medium mb-2 text-sm">失败样例</p>
                      <ul className="flex flex-col gap-1 font-mono text-xs">
                        {webpScanResult.failedSamples.slice(0, 5).map((sample) => (
                          <li key={sample.id} className="break-all">
                            <span className="opacity-70">
                              #{sample.id} {sample.path}：
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
            id="video-probe"
            category="可定时"
            icon={Film}
            title={videoScheduledTask?.name ?? '视频媒体探测与封面生成'}
            description={
              videoScheduledTask?.description ??
              '分类未识别媒体，探测视频音频、编码、时长和帧率，并生成缺失的视频封面。'
            }
            summary={getScheduledSummary(videoScheduledTask, videoProbeJob, Boolean(isVideoProbeRunning))}
            tone={getJobTone(videoProbeJob, Boolean(isVideoProbeRunning))}
            action={
              isVideoProbeRunning ? (
                <Button
                  variant="destructive"
                  onClick={() =>
                    confirmTaskCancellation('视频媒体探测与封面生成', () => cancelVideoProbeMutation.mutate())
                  }
                  disabled={isVideoProbeCancelling || cancelVideoProbeMutation.isPending}
                >
                  {isVideoProbeCancelling ? '正在取消…' : '取消任务'}
                </Button>
              ) : (
                <Button
                  onClick={() => videoScheduledTask && handleTriggerScheduledTask(videoScheduledTask)}
                  disabled={!videoScheduledTask || triggerScheduledTaskMutation.isPending}
                >
                  {triggeringTaskKey === videoScheduledTask?.key ? (
                    <Spinner data-icon="inline-start" aria-hidden="true" />
                  ) : (
                    <PlayCircle data-icon="inline-start" aria-hidden="true" />
                  )}
                  立即执行
                </Button>
              )
            }
          >
            <div className="rounded-lg border border-border bg-muted/10 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex flex-1 flex-col gap-1.5">
                  <label htmlFor="video-reprobe-path" className="text-sm font-medium text-foreground">
                    按路径重试视频探测
                  </label>
                  <p className="text-xs text-muted-foreground">输入数据库相对路径，或 SCAN_PATH 下的绝对路径。</p>
                  <Input
                    id="video-reprobe-path"
                    name="video-reprobe-path"
                    autoComplete="off"
                    value={videoReprobePath}
                    onChange={(event) => setVideoReprobePath(event.target.value)}
                    placeholder="例如 /artist/work/video.mp4…"
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
                  {reprobeVideoByPathMutation.isPending && <Spinner data-icon="inline-start" aria-hidden="true" />}
                  {reprobeVideoByPathMutation.isPending ? '探测中…' : '重试探测'}
                </Button>
              </div>
            </div>

            <JobStatus
              job={videoProbeJob}
              isRunning={Boolean(isVideoProbeRunning)}
              completeContent={
                <div className="flex flex-col gap-3 text-muted-foreground">
                  <div className="flex flex-col gap-1.5">
                    <p className="text-sm font-medium text-foreground">本次新分类 UNKNOWN 媒体：</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span>
                        视频：{' '}
                        <strong className="text-foreground font-medium">
                          {videoProbeResult?.classification?.videos ?? 0}
                        </strong>
                      </span>
                      <span>
                        图片：{' '}
                        <strong className="text-foreground font-medium">
                          {videoProbeResult?.classification?.images ?? 0}
                        </strong>
                      </span>
                      <span>
                        动图：{' '}
                        <strong className="text-foreground font-medium">
                          {videoProbeResult?.classification?.animations ?? 0}
                        </strong>
                      </span>
                      <span>
                        仍未知：
                        <strong className="text-foreground font-medium">
                          {videoProbeResult?.classification?.unknown ?? 0}
                        </strong>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 border-t border-border/50 pt-2">
                    <p className="text-sm font-medium text-foreground">探测与处理进度：</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span>
                        新建 metadata：{' '}
                        <strong className="text-foreground font-medium">
                          {videoProbeResult?.classification?.metadataRowsCreated ?? 0}
                        </strong>{' '}
                        行
                      </span>
                      <span>
                        成功：
                        <strong className="text-foreground font-medium">
                          {videoProbeResult?.probe?.processed ?? 0}
                        </strong>
                      </span>
                      <span>
                        失败：
                        <strong className="text-destructive font-medium">{videoProbeResult?.probe?.failed ?? 0}</strong>
                      </span>
                      <span>
                        剩余待探测：{' '}
                        <strong className="text-foreground font-medium">
                          {videoProbeResult?.probe?.remaining ?? 0}
                        </strong>
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 border-t border-border/50 pt-2">
                    <p className="text-sm font-medium text-foreground">视频封面处理：</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      <span>
                        待处理：{' '}
                        <strong className="text-foreground font-medium">{videoProbeResult?.poster?.total ?? 0}</strong>
                      </span>
                      <span>
                        处理：{' '}
                        <strong className="text-foreground font-medium">
                          {videoProbeResult?.poster?.processed ?? 0}
                        </strong>
                      </span>
                      <span>
                        生成：{' '}
                        <strong className="text-foreground font-medium">
                          {videoProbeResult?.poster?.generated ?? 0}
                        </strong>
                      </span>
                      <span>
                        跳过：{' '}
                        <strong className="text-foreground font-medium">
                          {videoProbeResult?.poster?.skipped ?? 0}
                        </strong>
                      </span>
                      <span>
                        失败：{' '}
                        <strong className="text-destructive font-medium">
                          {videoProbeResult?.poster?.failed ?? 0}
                        </strong>
                      </span>
                      <span>
                        剩余待处理：{' '}
                        <strong className="text-foreground font-medium">
                          {videoProbeResult?.poster?.remaining ?? 0}
                        </strong>
                      </span>
                    </div>
                  </div>
                  {videoProbeResult?.failedSamples && videoProbeResult.failedSamples.length > 0 && (
                    <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive mt-2">
                      <p className="font-medium mb-2 text-sm">失败样例</p>
                      <ul className="flex flex-col gap-1 font-mono text-xs">
                        {videoProbeResult.failedSamples.slice(0, 5).map((sample) => (
                          <li key={`${sample.stage}-${sample.imageId}`} className="break-all">
                            <span className="opacity-70">
                              {sample.stage === 'PROBE' ? '媒体探测' : '封面生成'} · #{sample.imageId} {sample.path}：
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

          <VideoStreamingOptimizationSection />

          <VideoKeyframeSection />

          <TaskSection
            id="chapter-previews"
            category="可定时"
            icon={ImagePlay}
            title={chapterPreviewScheduledTask?.name ?? '生成视频章节截图'}
            description={
              chapterPreviewScheduledTask?.description ?? '每日增量补齐缺失章节截图，也可手动执行全量校验与重新生成。'
            }
            summary={getScheduledSummary(
              chapterPreviewScheduledTask,
              chapterPreviewJob,
              Boolean(isChapterPreviewRunning)
            )}
            tone={getJobTone(chapterPreviewJob, Boolean(isChapterPreviewRunning))}
            action={
              isChapterPreviewRunning ? (
                <Button
                  variant="destructive"
                  onClick={() =>
                    confirmTaskCancellation('生成视频章节截图', () => cancelChapterPreviewMutation.mutate())
                  }
                  disabled={isChapterPreviewCancelling || cancelChapterPreviewMutation.isPending}
                >
                  {isChapterPreviewCancelling ? '正在取消…' : '取消任务'}
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
                      <Spinner data-icon="inline-start" aria-hidden="true" />
                    ) : (
                      <PlayCircle data-icon="inline-start" aria-hidden="true" />
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
                      <Spinner data-icon="inline-start" aria-hidden="true" />
                    ) : (
                      <PlayCircle data-icon="inline-start" aria-hidden="true" />
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
                <div className="flex flex-col gap-3 text-muted-foreground">
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>
                      模式：{' '}
                      <strong className="font-medium text-foreground">
                        {chapterPreviewResult?.mode === 'INCREMENTAL' ? '增量' : '全量'}
                      </strong>
                    </span>
                    <span>
                      待生成：{' '}
                      <strong className="font-medium text-foreground">{chapterPreviewResult?.pending ?? 0}</strong>
                    </span>
                    <span>
                      已处理：{' '}
                      <strong className="font-medium text-foreground">{chapterPreviewResult?.processed ?? 0}</strong>
                    </span>
                    <span>
                      复用：<strong className="font-medium text-foreground">{chapterPreviewResult?.reused ?? 0}</strong>
                    </span>
                    <span>
                      生成：{' '}
                      <strong className="font-medium text-foreground">{chapterPreviewResult?.generated ?? 0}</strong>
                    </span>
                    <span>
                      失败：
                      <strong className="font-medium text-destructive">{chapterPreviewResult?.failed ?? 0}</strong>
                    </span>
                    {chapterPreviewResult?.mode !== 'INCREMENTAL' && (
                      <span>
                        清理孤儿：{' '}
                        <strong className="font-medium text-foreground">
                          {chapterPreviewResult?.orphanedFilesDeleted ?? 0}
                        </strong>
                      </span>
                    )}
                  </div>
                  {chapterPreviewResult?.failedSamples && chapterPreviewResult.failedSamples.length > 0 && (
                    <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-destructive">
                      <p className="mb-2 text-sm font-medium">失败样例</p>
                      <ul className="flex flex-col gap-1 font-mono text-xs">
                        {chapterPreviewResult.failedSamples.slice(0, 5).map((sample, index) => (
                          <li
                            key={`${sample.imageId}-${sample.chapterOrder ?? 'manifest'}-${index}`}
                            className="break-all"
                          >
                            <span className="opacity-70">
                              #{sample.imageId}
                              {sample.chapterOrder === null ? '' : ` 章节 ${sample.chapterOrder + 1}`} {sample.path}：
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
        </TaskGroup>

        {standaloneScheduledTasks.length > 0 ? (
          <TaskGroup title="自动维护" description="按保留策略清理系统审计与历史数据。">
            {standaloneScheduledTasks.map((task) => {
              const isTaskRunning = Boolean(
                task.lastJobStatus && ['PENDING', 'RUNNING', 'CANCELLING'].includes(task.lastJobStatus)
              )
              return (
                <TaskSection
                  key={task.key}
                  id={`scheduled-${task.key}`}
                  category="可定时"
                  icon={Wrench}
                  title={task.name}
                  description={task.description}
                  summary={getStandaloneSummary(task)}
                  tone={isTaskRunning ? 'active' : task.lastJobStatus === 'FAILED' ? 'error' : 'idle'}
                  action={
                    <Button
                      onClick={() => requestStandaloneTaskTrigger(task, () => handleTriggerScheduledTask(task))}
                      disabled={isTaskRunning || triggerScheduledTaskMutation.isPending}
                    >
                      {triggeringTaskKey === task.key ? (
                        <Spinner data-icon="inline-start" aria-hidden="true" />
                      ) : (
                        <PlayCircle data-icon="inline-start" aria-hidden="true" />
                      )}
                      {isTaskRunning ? '执行中…' : getStandaloneTaskActionLabel(task)}
                    </Button>
                  }
                >
                  <StandaloneTaskFeedback task={task} />
                  {renderScheduleSettings(task)}
                </TaskSection>
              )
            })}
          </TaskGroup>
        ) : null}
      </TaskAccordion>
      <BackgroundTaskConsole />
    </div>
  )
}
