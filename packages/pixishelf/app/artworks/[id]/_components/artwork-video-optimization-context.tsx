'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuthUser } from '@/components/auth'
import { confirm } from '@/components/shared/global-confirm'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { isActiveVideoOptimization, type VideoOptimizationJobView } from '@/types/video-optimization'

interface ArtworkVideoOptimizationContextValue {
  canManage: boolean
  getJob: (imageId: number) => VideoOptimizationJobView | null
  isStarting: (imageId: number) => boolean
  enqueue: (media: ArtworkImageResponseDto) => void
  cancel: (job: VideoOptimizationJobView) => void
}

const ArtworkVideoOptimizationContext = createContext<ArtworkVideoOptimizationContextValue | null>(null)

export function ArtworkVideoOptimizationProvider({ imageIds, children }: { imageIds: number[]; children: ReactNode }) {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const user = useAuthUser()
  const [pollInterval, setPollInterval] = useState<number | false>(false)
  const [startingImageIds, setStartingImageIds] = useState<Set<number>>(() => new Set())
  const observedJobIdsRef = useRef(new Set<string>())
  const statusQuery = useQuery(
    trpc.job.getVideoStreamingOptimizationStatuses.queryOptions(
      { imageIds },
      { enabled: Boolean(user && imageIds.length > 0), refetchInterval: pollInterval }
    )
  )
  const jobs = useMemo(() => (statusQuery.data || []) as VideoOptimizationJobView[], [statusQuery.data])
  const refetchStatuses = statusQuery.refetch
  const jobsByImageId = useMemo(
    () =>
      new Map(
        jobs.flatMap((job) =>
          job.targetImageId === null || job.targetImageId === undefined ? [] : [[job.targetImageId, job] as const]
        )
      ),
    [jobs]
  )

  useEffect(() => {
    setPollInterval(jobs.some(isActiveVideoOptimization) ? 1000 : false)
  }, [jobs])

  useEffect(() => {
    for (const job of jobs) {
      if (isActiveVideoOptimization(job)) {
        observedJobIdsRef.current.add(job.id)
        continue
      }
      if (!observedJobIdsRef.current.has(job.id)) continue
      observedJobIdsRef.current.delete(job.id)
      if (job.status === 'COMPLETED') {
        window.location.reload()
        return
      }
      if (job.status === 'FAILED') toast.error(`MP4 无损播放优化失败: ${job.error || '未知错误'}`)
      if (job.status === 'CANCELLED') toast.info('MP4 无损播放优化已取消，原视频未替换')
    }
  }, [jobs])

  const enqueue = useCallback(
    (media: ArtworkImageResponseDto) => {
      if (!media.path.toLowerCase().endsWith('.mp4')) return

      confirm({
        title: '确认执行 MP4 无损播放优化？',
        description: (
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <p className="break-all font-mono text-xs">{media.path}</p>
            <p>任务会进入持久化队列，按提交顺序串行处理。执行时播放器将暂停，成功后刷新整个作品页。</p>
            <p>处理只移动 moov 并重建容器索引，不重新编码，也不会增加关键帧。</p>
            <p className="text-warning">成功后会原位替换文件；执行期间请勿从外部修改或移动该视频。</p>
          </div>
        ),
        confirmText: '加入优化队列',
        onConfirm: async () => {
          setStartingImageIds((current) => new Set(current).add(media.id))
          try {
            const result = await trpcClient.job.startVideoStreamingOptimization.mutate({ imageId: media.id })
            observedJobIdsRef.current.add(result.jobId)
            setPollInterval(1000)
            await refetchStatuses()
            if (result.reused) {
              toast.info(result.queuePosition ? `该视频已在队列第 ${result.queuePosition} 位` : '该视频正在优化')
            } else {
              toast.success(result.queuePosition ? `已加入队列，第 ${result.queuePosition} 位` : '已开始优化')
            }
          } catch (error) {
            toast.error(`加入优化队列失败: ${error instanceof Error ? error.message : '未知错误'}`)
          } finally {
            setStartingImageIds((current) => {
              const next = new Set(current)
              next.delete(media.id)
              return next
            })
          }
        }
      })
    },
    [refetchStatuses, trpcClient]
  )

  const cancel = useCallback(
    (job: VideoOptimizationJobView) => {
      void (async () => {
        try {
          const result = await trpcClient.job.cancelVideoStreamingOptimization.mutate({ jobId: job.id })
          if (result.success) toast.info(job.status === 'PENDING' ? '排队任务已取消' : '正在取消视频优化...')
          else toast.info('该任务已经结束')
          setPollInterval(1000)
          await refetchStatuses()
        } catch (error) {
          toast.error(`取消优化失败: ${error instanceof Error ? error.message : '未知错误'}`)
        }
      })()
    },
    [refetchStatuses, trpcClient]
  )

  const value = useMemo<ArtworkVideoOptimizationContextValue>(
    () => ({
      canManage: Boolean(user),
      getJob: (imageId) => jobsByImageId.get(imageId) ?? null,
      isStarting: (imageId) => startingImageIds.has(imageId),
      enqueue,
      cancel
    }),
    [cancel, enqueue, jobsByImageId, startingImageIds, user]
  )

  return <ArtworkVideoOptimizationContext.Provider value={value}>{children}</ArtworkVideoOptimizationContext.Provider>
}

export function useArtworkVideoOptimization(imageId: number) {
  const context = useContext(ArtworkVideoOptimizationContext)
  const job = context?.getJob(imageId) ?? null
  return {
    job,
    isStarting: context?.isStarting(imageId) ?? false,
    canManage: context?.canManage ?? false,
    suspendPlayback: (context?.isStarting(imageId) ?? false) || Boolean(job && isActiveVideoOptimization(job)),
    enqueue: context?.enqueue,
    cancel: context?.cancel
  }
}
