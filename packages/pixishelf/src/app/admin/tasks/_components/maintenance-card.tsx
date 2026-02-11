'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useTRPC } from '@/lib/trpc'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Progress } from '@/components/ui/progress'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

export function MaintenanceCard() {
  const trpc = useTRPC()
  const [pollInterval, setPollInterval] = useState<number | false>(false)

  // 查询当前任务状态
  const { data: activeJob, refetch } = useQuery(
    trpc.job.getRefillMetaSourceStatus.queryOptions(undefined, {
      refetchInterval: pollInterval
    })
  )

  // 监听任务状态以调整轮询
  useEffect(() => {
    if (activeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(activeJob.status)) {
      setPollInterval(1000) // 1秒轮询一次
    } else {
      setPollInterval(false)
    }
  }, [activeJob?.status])

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

  const isRunning = activeJob && ['PENDING', 'RUNNING', 'CANCELLING'].includes(activeJob.status)
  const isCancelling = activeJob?.status === 'CANCELLING'

  return (
    <Card>
      <CardHeader>
        <CardTitle>系统维护</CardTitle>
        <CardDescription>执行系统维护任务</CardDescription>
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
      </CardContent>
    </Card>
  )
}
