'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Progress } from '@/components/ui/progress'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

interface WebpTagSyncResult {
  expectedWebpArtworks?: number
  addedRelations?: number
  removedStaleRelations?: number
  finalWebpTagRelations?: number
}

function toWebpTagSyncResult(result: unknown): WebpTagSyncResult | null {
  return result && typeof result === 'object' ? (result as WebpTagSyncResult) : null
}

export function MaintenanceCard() {
  const trpc = useTRPC()
  const [pollInterval, setPollInterval] = useState<number | false>(false)
  const [webpPollInterval, setWebpPollInterval] = useState<number | false>(false)

  // 查询当前任务状态
  const { data: activeJob, refetch } = useQuery(
    trpc.job.getRefillMetaSourceStatus.queryOptions(undefined, {
      refetchInterval: pollInterval
    })
  )

  const webpJobQuery = useQuery(
    trpc.job.getWebpTagSyncStatus.queryOptions(undefined, {
      refetchInterval: webpPollInterval
    })
  )
  const webpJob = webpJobQuery.data as any
  const refetchWebpJob = webpJobQuery.refetch

  // 监听任务状态以调整轮询
  useEffect(() => {
    if (activeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(activeJob.status)) {
      setPollInterval(1000) // 1秒轮询一次
    } else {
      setPollInterval(false)
    }
  }, [activeJob?.status])

  useEffect(() => {
    if (webpJob && ['PENDING', 'RUNNING'].includes(webpJob.status)) {
      setWebpPollInterval(1000)
    } else {
      setWebpPollInterval(false)
    }
  }, [webpJob?.status])

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

  const startWebpMutation = useMutation(
    trpc.job.startWebpTagSync.mutationOptions({
      onSuccess: () => {
        toast.success('WebP 标签同步任务已启动')
        refetchWebpJob()
      },
      onError: (error) => {
        toast.error(`启动失败: ${error.message}`)
      }
    })
  )

  const isRunning = activeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(activeJob.status)
  const isCancelling = activeJob?.status === 'CANCELLING'
  const isWebpRunning = webpJob && ['PENDING', 'RUNNING'].includes(webpJob.status)
  const webpResult = toWebpTagSyncResult(webpJob?.result)

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
            <h4 className="font-medium">同步 WebP 标签</h4>
            <p className="text-sm text-neutral-500">
              根据作品媒体文件后缀，为包含 .webp 图片的作品补齐 webp 标签，并移除过期关联。
            </p>
          </div>
          <Button onClick={() => startWebpMutation.mutate()} disabled={Boolean(isWebpRunning) || startWebpMutation.isPending}>
            {startWebpMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isWebpRunning ? '同步中...' : '开始同步'}
          </Button>
        </div>

        {webpJob && (isWebpRunning || webpJob.status === 'COMPLETED' || webpJob.status === 'FAILED') && (
          <div className="space-y-2 p-4 bg-neutral-50 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="font-medium">
                状态: {webpJob.status}
                {webpJob.message && ` - ${webpJob.message}`}
              </span>
              <span>{webpJob.progress}%</span>
            </div>
            <Progress value={webpJob.progress} className="h-2" />
            {webpJob.error && <p className="text-sm text-red-500 mt-2">错误: {webpJob.error}</p>}
            {webpJob.status === 'COMPLETED' && (
              <p className="text-sm text-green-600 mt-2">
                任务完成：命中 {webpResult?.expectedWebpArtworks ?? 0} 个 WebP 作品，新增{' '}
                {webpResult?.addedRelations ?? 0} 个关联，移除 {webpResult?.removedStaleRelations ?? 0} 个过期关联，
                当前 webp 标签关联 {webpResult?.finalWebpTagRelations ?? 0} 个。
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
