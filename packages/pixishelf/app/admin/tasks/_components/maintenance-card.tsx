'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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

function toMediaDerivedTagSyncResult(result: unknown): MediaDerivedTagSyncResult | null {
  return result && typeof result === 'object' ? (result as MediaDerivedTagSyncResult) : null
}

export function MaintenanceCard() {
  const trpc = useTRPC()
  const [pollInterval, setPollInterval] = useState<number | false>(false)
  const [mediaTagPollInterval, setMediaTagPollInterval] = useState<number | false>(false)

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

  const isRunning = activeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(activeJob.status)
  const isCancelling = activeJob?.status === 'CANCELLING'
  const isMediaTagRunning = mediaTagJob && ['PENDING', 'RUNNING'].includes(mediaTagJob.status)
  const mediaTagResult = toMediaDerivedTagSyncResult(mediaTagJob?.result)

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
      </CardContent>
    </Card>
  )
}
