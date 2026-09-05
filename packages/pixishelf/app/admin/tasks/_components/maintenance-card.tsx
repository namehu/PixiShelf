'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Database, Film, ImagePlay, PlayCircle, Tags, Wrench } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { VideoProbeTaskActions, type VideoMediaProbeResult } from './video-probe-task-actions'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { useBackgroundJobEventSubscription } from '../../_components/background-job-event-provider'
import { AnimationScanLiveFeedback } from './animation-scan-live-feedback'
import { StandaloneTaskFeedback } from './standalone-task-feedback'
import { ACTIVE_TASK_STATUSES, formatTaskStatus } from './task-status'
import {
  collectUnseenLiveEvents,
  mergeLiveJobSnapshot,
  selectLiveJobForStatusCache,
  type LiveEventCursor
} from './live-event-reconciliation'
import { PixivAiDerivedTagSyncFeedback, type PixivAiDerivedTagSyncResult } from './pixiv-ai-derived-tag-sync-feedback'

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

interface VideoChapterPreviewResult {
  mode?: 'FULL' | 'INCREMENTAL'
  pending?: number
  processed?: number
  reused?: number
  generated?: number
  failed?: number
  audioProcessed?: number
  audioAudible?: number
  audioSilent?: number
  audioFailed?: number
  orphanedFilesDeleted?: number
  failedSamples?: Array<{ imageId: number; path: string; chapterOrder: number | null; error: string }>
}

function toMediaDerivedTagSyncResult(result: unknown): MediaDerivedTagSyncResult | null {
  return result && typeof result === 'object' ? (result as MediaDerivedTagSyncResult) : null
}

function toPixivAiDerivedTagSyncResult(result: unknown): PixivAiDerivedTagSyncResult | null {
  return result && typeof result === 'object' ? (result as PixivAiDerivedTagSyncResult) : null
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

export function getJobSummary(job: JobView | null | undefined, isRunning: boolean) {
  if (isRunning) return `${formatTaskStatus(job?.status)} · ${job?.progress ?? 0}%`
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

export function getStandaloneSummary(task: ScheduledTaskView) {
  if (task.lastJobStatus && ACTIVE_TASK_STATUSES.includes(task.lastJobStatus)) {
    return formatTaskStatus(task.lastJobStatus)
  }
  if (task.lastJobStatus === 'FAILED') return '需要处理 · 上次执行失败'
  if (!task.enabled) return null
  return task.executionWindow ? '下次 · 上海 00:00–08:00' : `下次 · 每日 ${task.time}`
}

export function getActiveTaskActionLabel(status: string | null | undefined, runningLabel: string) {
  if (status === 'PENDING') return '等待执行…'
  if (status === 'RETRY_WAIT') return '等待重试…'
  if (status === 'PAUSING') return '正在暂停…'
  if (status === 'PAUSED') return '任务已暂停'
  if (status === 'CANCELLING') return '正在取消…'
  return runningLabel
}

export function shouldPollStandaloneTasks(tasks: ScheduledTaskView[] | undefined) {
  return Boolean(tasks?.some((task) => task.lastJobStatus && ACTIVE_TASK_STATUSES.includes(task.lastJobStatus)))
}

export function getStandaloneTaskActionLabel(task: ScheduledTaskView) {
  if (task.key === 'job_event_retention_cleanup') return '运行只读预检'
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

export function requestPixivAiDerivedTagSync(dryRun: boolean, onTrigger: () => void) {
  if (dryRun) {
    onTrigger()
    return
  }
  confirm({
    title: '执行 Pixiv AI 标签历史回填？',
    description:
      '任务会按 500 条分批校准 AI生成 派生标签；人工标签和其他来源标签不会被改写。正式执行前应先完成只读预检并确认已有可恢复备份。',
    confirmText: '执行回填',
    onConfirm: onTrigger
  })
}

export function MaintenanceCard() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [triggeringTaskKey, setTriggeringTaskKey] = useState<string | null>(null)
  const [videoReprobePath, setVideoReprobePath] = useState('')
  const [trackedWebpJobId, setTrackedWebpJobId] = useState<string>()
  const requestedWebpJobId = useRef<string | null>(null)
  const liveEventCursor = useRef<LiveEventCursor>({ resetVersion: 0, eventId: null })
  const scheduledLiveEventCursor = useRef<LiveEventCursor>({ resetVersion: 0, eventId: null })
  const jobEvents = useBackgroundJobEventSubscription()

  const fallbackPolling = { liveConnected: jobEvents.status === 'connected', idleInterval: 30_000 }
  const pollRefill = useTaskPolling<JobView | null>(
    (job) => Boolean(job && ACTIVE_TASK_STATUSES.includes(job.status)),
    3_000,
    fallbackPolling
  )
  const pollMediaTags = useTaskPolling<JobView | null>(
    (job) => Boolean(job && ACTIVE_TASK_STATUSES.includes(job.status)),
    3_000,
    fallbackPolling
  )
  const pollCancellable = useTaskPolling<JobView | null>(
    (job) => Boolean(job && ACTIVE_TASK_STATUSES.includes(job.status)),
    3_000,
    fallbackPolling
  )
  const pollWebp = useTaskPolling<JobView | null>(
    (job) => Boolean(job && ACTIVE_TASK_STATUSES.includes(job.status)),
    3_000,
    fallbackPolling
  )
  const pollScheduledTasks = useTaskPolling<ScheduledTaskView[]>(shouldPollStandaloneTasks, 3_000, fallbackPolling)

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

  const pixivAiTagJobQuery = useQuery(
    trpc.job.getPixivAiDerivedTagSyncStatus.queryOptions(undefined, {
      refetchInterval: pollCancellable
    })
  )
  const pixivAiTagJob = pixivAiTagJobQuery.data as JobView | null | undefined
  const refetchPixivAiTagJob = pixivAiTagJobQuery.refetch

  const webpScanJobQueryOptions = useMemo(
    () => trpc.job.getWebpAnimationScanStatus.queryOptions(undefined, { refetchInterval: pollWebp }),
    [pollWebp, trpc]
  )
  const webpScanJobQuery = useQuery(webpScanJobQueryOptions)
  const webpScanJob = webpScanJobQuery.data as JobView | null | undefined
  const refetchWebpScanJob = webpScanJobQuery.refetch

  const latestWebpEvent = [...jobEvents.items].reverse().find(({ job }) => job.type === 'WEBP_ANIMATION_SCAN')
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

  useEffect(() => {
    if (!webpScanJob?.id) return
    if (requestedWebpJobId.current && requestedWebpJobId.current !== webpScanJob.id) return
    requestedWebpJobId.current = null
    if (trackedWebpJobId !== webpScanJob.id) setTrackedWebpJobId(webpScanJob.id)
  }, [trackedWebpJobId, webpScanJob?.id])

  useEffect(() => {
    if (!latestWebpEvent || !ACTIVE_TASK_STATUSES.includes(latestWebpEvent.job.status)) return
    if (requestedWebpJobId.current && requestedWebpJobId.current !== latestWebpEvent.job.id) return
    requestedWebpJobId.current = null
    if (latestWebpEvent.job.id !== trackedWebpJobId) setTrackedWebpJobId(latestWebpEvent.job.id)
  }, [latestWebpEvent, trackedWebpJobId])

  useEffect(() => {
    const unseen = collectUnseenLiveEvents(jobEvents.items, jobEvents.resetVersion, liveEventCursor.current)
    liveEventCursor.current = unseen.cursor
    const unseenItems = unseen.items
    if (unseenItems.length === 0) return
    const queryKeys = [
      ['REFILL_META_SOURCE', trpc.job.getRefillMetaSourceStatus.queryKey()],
      ['MEDIA_DERIVED_TAG_SYNC', trpc.job.getMediaDerivedTagSyncStatus.queryKey()],
      ['PIXIV_AI_DERIVED_TAG_SYNC', trpc.job.getPixivAiDerivedTagSyncStatus.queryKey()],
      ['WEBP_ANIMATION_SCAN', trpc.job.getWebpAnimationScanStatus.queryKey()],
      ['VIDEO_MEDIA_PROBE', trpc.job.getVideoMediaProbeStatus.queryKey()],
      ['VIDEO_CHAPTER_PREVIEW_GENERATION', trpc.job.getVideoChapterPreviewGenerationStatus.queryKey()]
    ] as const
    for (const [jobType, statusQueryKey] of queryKeys) {
      const current = queryClient.getQueryData<JobView | null>(statusQueryKey)
      const expectedJobId =
        jobType === 'WEBP_ANIMATION_SCAN'
          ? (requestedWebpJobId.current ?? trackedWebpJobId ?? current?.id)
          : current?.id
      const selection = selectLiveJobForStatusCache(unseenItems, jobType, expectedJobId)
      if (selection.job) {
        const liveJob = selection.job
        queryClient.setQueryData<JobView | null>(statusQueryKey, (cached) =>
          cached?.id === liveJob.id ? mergeLiveJobSnapshot(cached, liveJob) : liveJob
        )
      } else if (selection.sawDifferentJob) {
        void queryClient.invalidateQueries({ queryKey: statusQueryKey })
      }
    }
    const terminalTypes = new Set(
      unseenItems
        .filter(({ job }) => ['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(job.status))
        .map(({ job }) => job.type)
    )
    if (terminalTypes.size > 0) {
      for (const [jobType, queryKey] of queryKeys) {
        if (terminalTypes.has(jobType)) void queryClient.invalidateQueries({ queryKey })
      }
    }
  }, [jobEvents.items, jobEvents.resetVersion, queryClient, trackedWebpJobId, trpc])

  useEffect(() => {
    // Wait for the initial schedule snapshot before consuming its events.
    if (!scheduledTasksQuery.data) return
    const unseen = collectUnseenLiveEvents(jobEvents.items, jobEvents.resetVersion, scheduledLiveEventCursor.current)
    scheduledLiveEventCursor.current = unseen.cursor
    const scheduledTypes = new Set(scheduledTasksQuery.data.map((task) => task.type))
    // Live summaries do not identify the schedule. Refresh lifecycle changes
    // to discover its new lastJobId rather than assigning jobs by type alone.
    const scheduleChanged = unseen.items.some(
      ({ event, job }) =>
        scheduledTypes.has(job.type) &&
        (event.type.startsWith('job.') || event.type === 'worker.lease_recovered') &&
        event.type !== 'job.progress' &&
        event.type !== 'job.stage_changed'
    )
    if (scheduleChanged) void refetchScheduledTasks()
  }, [jobEvents.items, jobEvents.resetVersion, refetchScheduledTasks, scheduledTasksQuery.data])

  useEffect(() => {
    if (jobEvents.readyVersion === 0 && jobEvents.resetVersion === 0) return
    void refetch()
    void refetchMediaTagJob()
    void refetchPixivAiTagJob()
    void refetchWebpScanJob()
    void refetchVideoProbeJob()
    void refetchChapterPreviewJob()
    void refetchScheduledTasks()
  }, [
    jobEvents.readyVersion,
    jobEvents.resetVersion,
    refetch,
    refetchChapterPreviewJob,
    refetchMediaTagJob,
    refetchPixivAiTagJob,
    refetchScheduledTasks,
    refetchVideoProbeJob,
    refetchWebpScanJob
  ])

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

  const startPixivAiTagMutation = useMutation(
    trpc.job.startPixivAiDerivedTagSync.mutationOptions({
      onSuccess: (_data, variables) => {
        toast.success(variables.dryRun ? 'Pixiv AI 标签只读预检已启动' : 'Pixiv AI 标签历史回填已启动')
        refetchPixivAiTagJob()
      },
      onError: (error) => {
        toast.error(`启动失败：${error.message}`)
      }
    })
  )

  const cancelPixivAiTagMutation = useMutation(
    trpc.job.cancelPixivAiDerivedTagSync.mutationOptions({
      onSuccess: () => {
        toast.info('正在取消 Pixiv AI 标签校准任务…')
        refetchPixivAiTagJob()
      },
      onError: (error) => {
        toast.error(`取消失败：${error.message}`)
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
      onSuccess: (data, variables) => {
        if (variables.key === 'webp_animation_scan') {
          requestedWebpJobId.current = data.jobId
          setTrackedWebpJobId(data.jobId)
        }
        toast.success(
          variables.chapterPreviewMode === 'INCREMENTAL'
            ? '章节截图增量任务已启动'
            : variables.chapterPreviewMode === 'FULL'
              ? '章节截图全量任务已启动'
              : variables.videoProbeMode === 'RECHECK_HAS_AUDIO'
                ? '视频音频标记校准任务已启动'
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

  const isRunning = activeJob && ACTIVE_TASK_STATUSES.includes(activeJob.status)
  const isCancelling = activeJob?.status === 'CANCELLING'
  const isMediaTagRunning = mediaTagJob && ACTIVE_TASK_STATUSES.includes(mediaTagJob.status)
  const isPixivAiTagRunning = pixivAiTagJob && ACTIVE_TASK_STATUSES.includes(pixivAiTagJob.status)
  const isPixivAiTagCancelling = pixivAiTagJob?.status === 'CANCELLING'
  const isWebpScanRunning = webpScanJob && ACTIVE_TASK_STATUSES.includes(webpScanJob.status)
  const isVideoProbeRunning = videoProbeJob && ACTIVE_TASK_STATUSES.includes(videoProbeJob.status)
  const isVideoProbeCancelling = videoProbeJob?.status === 'CANCELLING'
  const isChapterPreviewRunning = chapterPreviewJob && ACTIVE_TASK_STATUSES.includes(chapterPreviewJob.status)
  const isChapterPreviewCancelling = chapterPreviewJob?.status === 'CANCELLING'
  const mediaTagResult = toMediaDerivedTagSyncResult(mediaTagJob?.result)
  const pixivAiTagResult = toPixivAiDerivedTagSyncResult(pixivAiTagJob?.result)
  const webpScanResult = toWebpAnimationScanResult(webpScanJob?.result)
  const videoProbeResult = toVideoMediaProbeResult(videoProbeJob?.result)
  const chapterPreviewResult = toVideoChapterPreviewResult(chapterPreviewJob?.result)
  const handleSaveScheduledTask = (task: ScheduledTaskView) => {
    const draft = taskDrafts[task.key]
    if (!draft) return

    updateScheduledTaskMutation.mutate(getScheduledTaskUpdate(task, draft))
  }

  const handleTriggerScheduledTask = (
    task: ScheduledTaskView,
    chapterPreviewMode?: 'FULL' | 'INCREMENTAL',
    videoProbeMode?: 'INCREMENTAL' | 'RECHECK_HAS_AUDIO'
  ) => {
    const mode = chapterPreviewMode ?? videoProbeMode
    setTriggeringTaskKey(mode ? `${task.key}:${mode}` : task.key)
    triggerScheduledTaskMutation.mutate({ key: task.key, chapterPreviewMode, videoProbeMode })
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
                {isMediaTagRunning ? getActiveTaskActionLabel(mediaTagJob?.status, '同步中…') : '开始同步'}
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

          <TaskSection
            id="pixiv-ai-derived-tag-sync"
            category="手动任务"
            icon={Tags}
            title="校准 Pixiv AI 标签"
            description="依据 pixivAiType 校准 AI生成 派生标签；支持只读预检，并保护人工与其他来源标签。"
            summary={getJobSummary(pixivAiTagJob, Boolean(isPixivAiTagRunning))}
            tone={getJobTone(pixivAiTagJob, Boolean(isPixivAiTagRunning))}
            action={
              isPixivAiTagRunning ? (
                <Button
                  variant="destructive"
                  onClick={() => confirmTaskCancellation('校准 Pixiv AI 标签', () => cancelPixivAiTagMutation.mutate())}
                  disabled={isPixivAiTagCancelling || cancelPixivAiTagMutation.isPending}
                >
                  {isPixivAiTagCancelling ? '正在取消…' : '取消任务'}
                </Button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      requestPixivAiDerivedTagSync(true, () => startPixivAiTagMutation.mutate({ dryRun: true }))
                    }
                    disabled={startPixivAiTagMutation.isPending}
                  >
                    {startPixivAiTagMutation.isPending && startPixivAiTagMutation.variables?.dryRun ? (
                      <Spinner data-icon="inline-start" aria-hidden="true" />
                    ) : null}
                    只读预检
                  </Button>
                  <Button
                    onClick={() =>
                      requestPixivAiDerivedTagSync(false, () => startPixivAiTagMutation.mutate({ dryRun: false }))
                    }
                    disabled={startPixivAiTagMutation.isPending}
                  >
                    {startPixivAiTagMutation.isPending && !startPixivAiTagMutation.variables?.dryRun ? (
                      <Spinner data-icon="inline-start" aria-hidden="true" />
                    ) : null}
                    执行回填
                  </Button>
                </div>
              )
            }
          >
            <JobStatus
              job={pixivAiTagJob}
              isRunning={Boolean(isPixivAiTagRunning)}
              completeContent={<PixivAiDerivedTagSyncFeedback result={pixivAiTagResult} />}
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
                {isWebpScanRunning ? getActiveTaskActionLabel(webpScanJob?.status, '识别中…') : '立即执行'}
              </Button>
            }
          >
            <JobStatus
              job={webpScanJob}
              isRunning={Boolean(isWebpScanRunning)}
              progressContent={<AnimationScanLiveFeedback job={webpScanJob} />}
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
                              #{sample.id} <PrivacySensitiveText>{sample.path}</PrivacySensitiveText>：
                            </span>{' '}
                            <PrivacySensitiveText>{sample.error}</PrivacySensitiveText>
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
                <VideoProbeTaskActions
                  task={videoScheduledTask}
                  isPending={triggerScheduledTaskMutation.isPending}
                  triggeringTaskKey={triggeringTaskKey}
                  onTrigger={(task, mode) => handleTriggerScheduledTask(task, undefined, mode)}
                />
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
                        模式：{' '}
                        <strong className="text-foreground font-medium">
                          {videoProbeResult?.mode === 'RECHECK_HAS_AUDIO' ? '校准现有有音频' : '增量'}
                        </strong>
                      </span>
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
                              {sample.stage === 'PROBE' ? '媒体探测' : '封面生成'} · #{sample.imageId}{' '}
                              <PrivacySensitiveText>{sample.path}</PrivacySensitiveText>：
                            </span>{' '}
                            <PrivacySensitiveText>{sample.error}</PrivacySensitiveText>
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
                    <span>
                      音频检测：{' '}
                      <strong className="font-medium text-foreground">
                        {chapterPreviewResult?.audioProcessed ?? 0}
                      </strong>
                    </span>
                    <span>
                      有声：{' '}
                      <strong className="font-medium text-foreground">{chapterPreviewResult?.audioAudible ?? 0}</strong>
                    </span>
                    <span>
                      静音：{' '}
                      <strong className="font-medium text-foreground">{chapterPreviewResult?.audioSilent ?? 0}</strong>
                    </span>
                    <span>
                      音频失败：{' '}
                      <strong className="font-medium text-destructive">{chapterPreviewResult?.audioFailed ?? 0}</strong>
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
                              {sample.chapterOrder === null ? '' : ` 章节 ${sample.chapterOrder + 1}`}{' '}
                              <PrivacySensitiveText>{sample.path}</PrivacySensitiveText>：
                            </span>{' '}
                            <PrivacySensitiveText>{sample.error}</PrivacySensitiveText>
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
              const isTaskRunning = Boolean(task.lastJobStatus && ACTIVE_TASK_STATUSES.includes(task.lastJobStatus))
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
                      {isTaskRunning
                        ? getActiveTaskActionLabel(task.lastJobStatus, '执行中…')
                        : getStandaloneTaskActionLabel(task)}
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
