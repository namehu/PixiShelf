'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Progress } from '@/components/ui/progress'
import { Loader2 } from 'lucide-react'
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
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <h4 className="font-medium">{title}</h4>
          <p className="text-sm text-neutral-500">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      </div>
      {children}
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
    <div className="space-y-2 rounded-lg bg-neutral-50 p-4">
      <div className="flex justify-between gap-3 text-sm">
        <span className="font-medium">
          状态: {job?.status}
          {job?.message && ` - ${job.message}`}
        </span>
        <span>{job?.progress ?? 0}%</span>
      </div>
      <Progress value={job?.progress ?? 0} className="h-2" />
      {job?.error && <p className="mt-2 text-sm text-red-500">错误: {job.error}</p>}
      {job?.status === 'COMPLETED' && (completeContent ?? <p className="mt-2 text-sm text-green-600">任务完成</p>)}
      {job?.status === 'CANCELLED' && <p className="mt-2 text-sm text-neutral-500">任务已取消</p>}
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
    <div className="space-y-3 rounded-lg border border-dashed p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <h5 className="text-sm font-medium">定时计划</h5>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
            <span>模式：{task.scheduleMode === 'DAILY' ? '每日' : task.scheduleMode}</span>
            <span>时区：{task.timezone}</span>
            <span>互斥组：{task.mutexKey || '-'}</span>
            <span>下次计划：{task.nextRunAt || '-'}</span>
            <span>上次自动日期：{task.lastTriggeredDate || '-'}</span>
            <span>上次触发：{formatDateTime(task.lastTriggeredAt)}</span>
            <span>最近任务：{task.lastJobStatus || '-'}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[auto_120px_90px_auto] sm:items-center">
          <div className="flex items-center gap-2">
            <Switch checked={draft.enabled} onCheckedChange={(checked) => onDraftChange({ enabled: checked })} />
            <span className="text-sm">{draft.enabled ? '启用' : '停用'}</span>
          </div>
          <Input
            type="time"
            value={draft.time}
            onChange={(event) => onDraftChange({ time: event.target.value })}
            className="h-9"
          />
          <Input
            type="number"
            min={0}
            max={1000}
            value={draft.priority}
            onChange={(event) => onDraftChange({ priority: event.target.value })}
            className="h-9"
            title="优先级，数字越小越先执行"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={onSave}
            disabled={isSaving || !changed || priorityInvalid}
          >
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

  const scheduledTasksQuery = useQuery(trpc.job.listScheduledTasks.queryOptions())
  const scheduledTasks = (scheduledTasksQuery.data ?? []) as ScheduledTaskView[]
  const refetchScheduledTasks = scheduledTasksQuery.refetch

  const scheduledTasksByKey = useMemo(() => {
    return new Map(scheduledTasks.map((task) => [task.key, task]))
  }, [scheduledTasks])

  const webpScheduledTask = scheduledTasksByKey.get('webp_animation_scan')
  const videoScheduledTask = scheduledTasksByKey.get('video_media_probe')
  const standaloneScheduledTasks = scheduledTasks.filter(
    (task) => !['webp_animation_scan', 'video_media_probe'].includes(task.key)
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
      onSuccess: () => {
        toast.success('计划任务已手动触发')
        refetchScheduledTasks()
        refetchWebpScanJob()
        refetchVideoProbeJob()
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
  const mediaTagResult = toMediaDerivedTagSyncResult(mediaTagJob?.result)
  const webpScanResult = toWebpAnimationScanResult(webpScanJob?.result)
  const videoProbeResult = toVideoMediaProbeResult(videoProbeJob?.result)

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

  const handleTriggerScheduledTask = (task: ScheduledTaskView) => {
    setTriggeringTaskKey(task.key)
    triggerScheduledTaskMutation.mutate({ key: task.key })
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
    <Card>
      <CardHeader>
        <CardTitle>数据修正</CardTitle>
        <CardDescription>按任务集中管理手动执行、执行进度和定时计划</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
                {startMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
              {startMediaTagMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isMediaTagRunning ? '同步中...' : '开始同步'}
            </Button>
          }
        >
          <JobStatus
            job={mediaTagJob}
            isRunning={Boolean(isMediaTagRunning)}
            completeContent={
              <p className="mt-2 text-sm text-green-600">
                任务完成：image {mediaTagResult?.image?.finalRelations ?? 0} 个，video{' '}
                {mediaTagResult?.video?.finalRelations ?? 0} 个，webp {mediaTagResult?.webp?.finalRelations ?? 0}{' '}
                个；本次新增{' '}
                {(mediaTagResult?.image?.addedRelations ?? 0) +
                  (mediaTagResult?.video?.addedRelations ?? 0) +
                  (mediaTagResult?.webp?.addedRelations ?? 0)}{' '}
                个关联，移除{' '}
                {(mediaTagResult?.image?.removedStaleRelations ?? 0) +
                  (mediaTagResult?.video?.removedStaleRelations ?? 0) +
                  (mediaTagResult?.webp?.removedStaleRelations ?? 0)}{' '}
                个过期关联。
              </p>
            }
          />
        </TaskSection>

        <TaskSection
          title={webpScheduledTask?.name ?? '识别 WebP 动图'}
          description={webpScheduledTask?.description ?? '初始化未处理的 WebP 图片，并按每批 20 个识别静态图或动图。'}
          action={
            <Button
              onClick={() => webpScheduledTask && handleTriggerScheduledTask(webpScheduledTask)}
              disabled={!webpScheduledTask || Boolean(isWebpScanRunning) || triggerScheduledTaskMutation.isPending}
            >
              {triggeringTaskKey === webpScheduledTask?.key && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isWebpScanRunning ? '识别中...' : '立即执行'}
            </Button>
          }
        >
          <JobStatus
            job={webpScanJob}
            isRunning={Boolean(isWebpScanRunning)}
            completeContent={
              <div className="mt-2 space-y-2 text-sm text-green-600">
                <p>
                  任务完成：初始化 {webpScanResult?.initialized ?? 0} 个，已处理 {webpScanResult?.processed ?? 0}{' '}
                  个；动图 {webpScanResult?.animated ?? 0} 个，静态 {webpScanResult?.static ?? 0} 个，失败{' '}
                  {webpScanResult?.failed ?? 0} 个，剩余待处理 {webpScanResult?.remainingPending ?? 0} 个。
                </p>
                {webpScanResult?.failedSamples && webpScanResult.failedSamples.length > 0 && (
                  <div className="rounded border border-red-200 bg-red-50 p-2 text-red-700">
                    <p className="font-medium">失败样例</p>
                    <ul className="mt-1 space-y-1">
                      {webpScanResult.failedSamples.slice(0, 5).map((sample) => (
                        <li key={sample.id} className="break-all">
                          #{sample.id} {sample.path}: {sample.error}
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
          description={videoScheduledTask?.description ?? '分类未识别媒体，并使用 ffprobe 探测视频音频、编码、时长和帧率。'}
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
                {triggeringTaskKey === videoScheduledTask?.key && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                立即执行
              </Button>
            )
          }
        >
          <div className="flex flex-col gap-2 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 space-y-1">
              <h5 className="text-sm font-medium">按路径重试视频探测</h5>
              <p className="text-xs text-neutral-500">输入数据库相对路径，或 SCAN_PATH 下的绝对路径。</p>
            </div>
            <Input
              value={videoReprobePath}
              onChange={(event) => setVideoReprobePath(event.target.value)}
              placeholder="/artist/work/video.mp4"
              className="h-9 sm:max-w-md"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && videoReprobePath.trim() && !reprobeVideoByPathMutation.isPending) {
                  reprobeVideoByPathMutation.mutate({ path: videoReprobePath })
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => reprobeVideoByPathMutation.mutate({ path: videoReprobePath })}
              disabled={!videoReprobePath.trim() || reprobeVideoByPathMutation.isPending}
              className="h-9 shrink-0"
            >
              {reprobeVideoByPathMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              重试探测
            </Button>
          </div>

          <JobStatus
            job={videoProbeJob}
            isRunning={Boolean(isVideoProbeRunning)}
            completeContent={
              <div className="mt-2 space-y-2 text-sm text-green-600">
                <p>
                  任务完成：本次新分类 UNKNOWN 媒体：视频 {videoProbeResult?.classifiedVideos ?? 0} 个，图片{' '}
                  {videoProbeResult?.classifiedImages ?? 0} 个，动图 {videoProbeResult?.classifiedAnimations ?? 0}{' '}
                  个，仍未知 {videoProbeResult?.unknown ?? 0} 个；本次新建视频 metadata{' '}
                  {videoProbeResult?.metadataRowsCreated ?? 0} 行；本次探测/重试视频：成功{' '}
                  {videoProbeResult?.processed ?? 0} 个，失败 {videoProbeResult?.failed ?? 0} 个；当前剩余待探测{' '}
                  {videoProbeResult?.remainingPending ?? 0} 个。
                </p>
                <p>
                  视频封面：处理 {videoProbeResult?.poster?.processed ?? 0} 个，生成{' '}
                  {videoProbeResult?.poster?.generated ?? 0} 个，失败 {videoProbeResult?.poster?.failed ?? 0}{' '}
                  个，清理孤儿封面 {videoProbeResult?.poster?.orphanedFilesDeleted ?? 0} 个。
                </p>
                {videoProbeResult?.failedSamples && videoProbeResult.failedSamples.length > 0 && (
                  <div className="rounded border border-red-200 bg-red-50 p-2 text-red-700">
                    <p className="font-medium">失败样例</p>
                    <ul className="mt-1 space-y-1">
                      {videoProbeResult.failedSamples.slice(0, 5).map((sample) => (
                        <li key={sample.imageId} className="break-all">
                          #{sample.imageId} {sample.path}: {sample.error}
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
                {triggeringTaskKey === task.key && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                立即执行
              </Button>
            }
          >
            <div className="rounded-lg bg-neutral-50 p-4 text-sm text-neutral-600">
              最近任务：{task.lastJobStatus || '-'}
              {task.lastJobId && <span className="ml-3 break-all">任务 ID：{task.lastJobId}</span>}
            </div>
            {renderScheduleSettings(task)}
          </TaskSection>
        ))}
      </CardContent>
    </Card>
  )
}
