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
import { useEffect, useState } from 'react'

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
}

interface ScheduledTaskView {
  key: string
  type: string
  name: string
  description: string
  enabled: boolean
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

function toMediaDerivedTagSyncResult(result: unknown): MediaDerivedTagSyncResult | null {
  return result && typeof result === 'object' ? (result as MediaDerivedTagSyncResult) : null
}

function toWebpAnimationScanResult(result: unknown): WebpAnimationScanResult | null {
  return result && typeof result === 'object' ? (result as WebpAnimationScanResult) : null
}

function toVideoMediaProbeResult(result: unknown): VideoMediaProbeResult | null {
  return result && typeof result === 'object' ? (result as VideoMediaProbeResult) : null
}

export function MaintenanceCard() {
  const trpc = useTRPC()
  const [pollInterval, setPollInterval] = useState<number | false>(false)
  const [mediaTagPollInterval, setMediaTagPollInterval] = useState<number | false>(false)
  const [webpScanPollInterval, setWebpScanPollInterval] = useState<number | false>(false)
  const [videoProbePollInterval, setVideoProbePollInterval] = useState<number | false>(false)
  const [taskDrafts, setTaskDrafts] = useState<Record<string, { enabled: boolean; time: string; priority: string }>>({})

  // 查询当前任务状态
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
  const mediaTagJob = mediaTagJobQuery.data as any
  const refetchMediaTagJob = mediaTagJobQuery.refetch

  const webpScanJobQuery = useQuery(
    trpc.job.getWebpAnimationScanStatus.queryOptions(undefined, {
      refetchInterval: webpScanPollInterval
    })
  )
  const webpScanJob = webpScanJobQuery.data as any
  const refetchWebpScanJob = webpScanJobQuery.refetch

  const videoProbeJobQuery = useQuery(
    trpc.job.getVideoMediaProbeStatus.queryOptions(undefined, {
      refetchInterval: videoProbePollInterval
    })
  )
  const videoProbeJob = videoProbeJobQuery.data as any
  const refetchVideoProbeJob = videoProbeJobQuery.refetch

  const scheduledTasksQuery = useQuery(trpc.job.listScheduledTasks.queryOptions())
  const scheduledTasks = (scheduledTasksQuery.data ?? []) as ScheduledTaskView[]
  const refetchScheduledTasks = scheduledTasksQuery.refetch

  // 监听任务状态以调整轮询
  useEffect(() => {
    if (activeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(activeJob.status)) {
      setPollInterval(1000) // 1秒轮询一次
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

  // 开始任务 Mutation
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

  // 取消任务 Mutation
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

  const startWebpScanMutation = useMutation(
    trpc.job.startWebpAnimationScan.mutationOptions({
      onSuccess: () => {
        toast.success('WebP 动图识别任务已启动')
        refetchWebpScanJob()
      },
      onError: (error) => {
        toast.error(`启动失败: ${error.message}`)
      }
    })
  )

  const startVideoProbeMutation = useMutation(
    trpc.job.startVideoMediaProbe.mutationOptions({
      onSuccess: () => {
        toast.success('视频媒体探测任务已启动')
        refetchVideoProbeJob()
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

  const updateTaskDraft = (key: string, patch: Partial<{ enabled: boolean; time: string; priority: string }>) => {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>数据修正</CardTitle>
        <CardDescription>修正历史数据缺失或派生字段不一致的问题</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-1">
            <h4 className="font-medium">补全元数据源 (MetaSource)</h4>
            <p className="text-sm text-neutral-500">
              递归扫描目录，根据文件名补全数据库中缺失的 metaSource 字段。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button 
                variant="destructive" 
                onClick={() => cancelMutation.mutate()}
                disabled={isCancelling || cancelMutation.isPending}
              >
                {isCancelling ? '正在取消...' : '取消任务'}
              </Button>
            ) : (
              <Button 
                onClick={() => startMutation.mutate()}
                disabled={startMutation.isPending}
              >
                {startMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                开始补全
              </Button>
            )}
          </div>
        </div>

        {activeJob && (isRunning || activeJob.status === 'COMPLETED' || activeJob.status === 'FAILED') && (
          <div className="space-y-2 p-4 bg-neutral-50 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="font-medium">
                状态: {activeJob.status} 
                {activeJob.message && ` - ${activeJob.message}`}
              </span>
              <span>{activeJob.progress}%</span>
            </div>
            <Progress value={activeJob.progress} className="h-2" />
            {activeJob.error && (
              <p className="text-sm text-red-500 mt-2">错误: {activeJob.error}</p>
            )}
            {activeJob.status === 'COMPLETED' && (
               <p className="text-sm text-green-600 mt-2">任务完成</p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-1">
            <h4 className="font-medium">同步媒体标签</h4>
            <p className="text-sm text-neutral-500">
              根据作品媒体文件后缀，同步 image、video、webp 系统标签，并移除过期关联。
            </p>
          </div>
          <Button
            onClick={() => startMediaTagMutation.mutate()}
            disabled={Boolean(isMediaTagRunning) || startMediaTagMutation.isPending}
          >
            {startMediaTagMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isMediaTagRunning ? '同步中...' : '开始同步'}
          </Button>
        </div>

        {mediaTagJob && (isMediaTagRunning || mediaTagJob.status === 'COMPLETED' || mediaTagJob.status === 'FAILED') && (
          <div className="space-y-2 p-4 bg-neutral-50 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="font-medium">
                状态: {mediaTagJob.status}
                {mediaTagJob.message && ` - ${mediaTagJob.message}`}
              </span>
              <span>{mediaTagJob.progress}%</span>
            </div>
            <Progress value={mediaTagJob.progress} className="h-2" />
            {mediaTagJob.error && <p className="text-sm text-red-500 mt-2">错误: {mediaTagJob.error}</p>}
            {mediaTagJob.status === 'COMPLETED' && (
              <p className="text-sm text-green-600 mt-2">
                任务完成：image {mediaTagResult?.image?.finalRelations ?? 0} 个，video{' '}
                {mediaTagResult?.video?.finalRelations ?? 0} 个，webp {mediaTagResult?.webp?.finalRelations ?? 0} 个；
                本次新增{' '}
                {(mediaTagResult?.image?.addedRelations ?? 0) +
                  (mediaTagResult?.video?.addedRelations ?? 0) +
                  (mediaTagResult?.webp?.addedRelations ?? 0)}{' '}
                个关联，移除{' '}
                {(mediaTagResult?.image?.removedStaleRelations ?? 0) +
                  (mediaTagResult?.video?.removedStaleRelations ?? 0) +
                  (mediaTagResult?.webp?.removedStaleRelations ?? 0)}{' '}
                个过期关联。
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-1">
            <h4 className="font-medium">识别 WebP 动图</h4>
            <p className="text-sm text-neutral-500">
              初始化未处理的 WebP 图片，并按每批 20 个识别静态图或动图。
            </p>
          </div>
          <Button
            onClick={() => startWebpScanMutation.mutate()}
            disabled={Boolean(isWebpScanRunning) || startWebpScanMutation.isPending}
          >
            {startWebpScanMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isWebpScanRunning ? '识别中...' : '处理待处理 WebP'}
          </Button>
        </div>

        {webpScanJob &&
          (isWebpScanRunning || webpScanJob.status === 'COMPLETED' || webpScanJob.status === 'FAILED') && (
            <div className="space-y-2 p-4 bg-neutral-50 rounded-lg">
              <div className="flex justify-between text-sm">
                <span className="font-medium">
                  状态: {webpScanJob.status}
                  {webpScanJob.message && ` - ${webpScanJob.message}`}
                </span>
                <span>{webpScanJob.progress}%</span>
              </div>
              <Progress value={webpScanJob.progress} className="h-2" />
              {webpScanJob.error && <p className="text-sm text-red-500 mt-2">错误: {webpScanJob.error}</p>}
              {webpScanJob.status === 'COMPLETED' && (
                <div className="space-y-2 text-sm text-green-600 mt-2">
                  <p>
                    任务完成：初始化 {webpScanResult?.initialized ?? 0} 个，已处理{' '}
                    {webpScanResult?.processed ?? 0} 个；动图 {webpScanResult?.animated ?? 0} 个，静态{' '}
                    {webpScanResult?.static ?? 0} 个，失败 {webpScanResult?.failed ?? 0} 个，剩余待处理{' '}
                    {webpScanResult?.remainingPending ?? 0} 个。
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
              )}
            </div>
          )}

        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="space-y-1">
            <h4 className="font-medium">视频媒体探测</h4>
            <p className="text-sm text-neutral-500">
              分类未识别媒体，并使用 ffprobe 探测视频音频、编码、时长和帧率。
            </p>
          </div>
          {isVideoProbeRunning ? (
            <Button
              variant="destructive"
              onClick={() => cancelVideoProbeMutation.mutate()}
              disabled={isVideoProbeCancelling || cancelVideoProbeMutation.isPending}
            >
              {isVideoProbeCancelling ? '正在取消...' : '取消任务'}
            </Button>
          ) : (
            <Button onClick={() => startVideoProbeMutation.mutate()} disabled={startVideoProbeMutation.isPending}>
              {startVideoProbeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              开始探测
            </Button>
          )}
        </div>

        {videoProbeJob &&
          (isVideoProbeRunning || videoProbeJob.status === 'COMPLETED' || videoProbeJob.status === 'FAILED') && (
            <div className="space-y-2 p-4 bg-neutral-50 rounded-lg">
              <div className="flex justify-between text-sm">
                <span className="font-medium">
                  状态: {videoProbeJob.status}
                  {videoProbeJob.message && ` - ${videoProbeJob.message}`}
                </span>
                <span>{videoProbeJob.progress}%</span>
              </div>
              <Progress value={videoProbeJob.progress} className="h-2" />
              {videoProbeJob.error && <p className="text-sm text-red-500 mt-2">错误: {videoProbeJob.error}</p>}
              {videoProbeJob.status === 'COMPLETED' && (
                <div className="space-y-2 text-sm text-green-600 mt-2">
                  <p>
                    任务完成：本次新分类 UNKNOWN 媒体：视频 {videoProbeResult?.classifiedVideos ?? 0} 个，图片{' '}
                    {videoProbeResult?.classifiedImages ?? 0} 个，动图{' '}
                    {videoProbeResult?.classifiedAnimations ?? 0} 个，仍未知 {videoProbeResult?.unknown ?? 0} 个；本次新建视频
                    metadata {videoProbeResult?.metadataRowsCreated ?? 0} 行；本次探测/重试视频：成功{' '}
                    {videoProbeResult?.processed ?? 0} 个，失败 {videoProbeResult?.failed ?? 0} 个；当前剩余待探测{' '}
                    {videoProbeResult?.remainingPending ?? 0} 个。
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
              )}
            </div>
          )}

        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <h4 className="font-medium">计划任务管理</h4>
            <p className="text-sm text-neutral-500">
              Docker scheduler 容器定期调用内部 tick 接口，应用根据这里的配置判断是否触发任务。
            </p>
          </div>

          {scheduledTasks.length === 0 ? (
            <div className="rounded bg-neutral-50 p-3 text-sm text-neutral-500">暂无计划任务</div>
          ) : (
            <div className="space-y-3">
              {scheduledTasks.map((task) => {
                const draft = taskDrafts[task.key] ?? {
                  enabled: task.enabled,
                  time: task.time,
                  priority: String(task.priority)
                }

                return (
                  <div key={task.key} className="rounded-md border bg-white p-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{task.name}</span>
                          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">
                            {task.type}
                          </span>
                        </div>
                        <p className="text-sm text-neutral-500">{task.description}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
                          <span>互斥组：{task.mutexKey || '-'}</span>
                          <span>时区：{task.timezone}</span>
                          <span>最近任务：{task.lastJobStatus || '-'}</span>
                          <span>上次自动日期：{task.lastTriggeredDate || '-'}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[auto_120px_90px_auto_auto] sm:items-center">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={draft.enabled}
                            onCheckedChange={(checked) => updateTaskDraft(task.key, { enabled: checked })}
                          />
                          <span className="text-sm">{draft.enabled ? '启用' : '停用'}</span>
                        </div>
                        <Input
                          type="time"
                          value={draft.time}
                          onChange={(event) => updateTaskDraft(task.key, { time: event.target.value })}
                          className="h-9"
                        />
                        <Input
                          type="number"
                          min={0}
                          max={1000}
                          value={draft.priority}
                          onChange={(event) => updateTaskDraft(task.key, { priority: event.target.value })}
                          className="h-9"
                          title="优先级，数字越小越先执行"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSaveScheduledTask(task)}
                          disabled={updateScheduledTaskMutation.isPending}
                        >
                          保存
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => triggerScheduledTaskMutation.mutate({ key: task.key })}
                          disabled={triggerScheduledTaskMutation.isPending}
                        >
                          立即执行
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
