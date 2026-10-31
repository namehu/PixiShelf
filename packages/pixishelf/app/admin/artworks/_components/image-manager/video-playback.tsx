'use client'
import { createContext, useContext, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Film, RotateCcw, Trash2, X } from 'lucide-react'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatFileSize } from '@/utils/media'
import { formatBackgroundJobStatus } from '@/app/admin/tasks/_components/background-task-format'
import type { videoPlaybackStatuses } from '@/services/video-playback-service'

type Status = Awaited<ReturnType<typeof videoPlaybackStatuses>>[number]
const active = new Set(['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'])
const Context = createContext<{
  statuses: Status[]
  busy: boolean
  generate: (ids: number[]) => void
  remove: (id: number) => void
  retry: (id: string) => void
  cancel: (id: string) => void
} | null>(null)

export function VideoPlaybackManagerProvider({ imageIds, children }: { imageIds: number[]; children: ReactNode }) {
  const trpc = useTRPC(),
    client = useTRPCClient()
  const [busy, setBusy] = useState(false)
  const query = useQuery(
    trpc.videoPlayback.statuses.queryOptions(
      { imageIds },
      {
        enabled: imageIds.length > 0,
        refetchInterval: (query) =>
          query.state.data?.some((item) => item.job && active.has(item.job.status)) ? 1000 : false
      }
    )
  )
  const perform = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await operation()
      toast.success(message)
      await query.refetch()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败，请重试')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Context.Provider
      value={{
        statuses: query.data ?? [],
        busy,
        generate: (ids) => {
          void perform(async () => {
            const results = await client.videoPlayback.generate.mutate({ imageIds: ids })
            const failures = results.filter((item) => item.error)
            if (failures.length) toast.error(`${failures.length} 个视频提交失败：${failures[0]?.error}`)
            if (failures.length === results.length) throw new Error('没有视频成功入队')
          }, '播放副本任务已提交，可在任务中心查看')
        },
        remove: (imageId) => {
          void perform(() => client.videoPlayback.remove.mutate({ imageId }), '副本已停用并安排回收，原片保留')
        },
        retry: (jobId) => {
          void perform(() => client.videoPlayback.retry.mutate({ jobId }), '播放副本重试任务已提交')
        },
        cancel: (jobId) => {
          void perform(() => client.videoPlayback.cancel.mutate({ jobId }), '已请求取消副本生成')
        }
      }}
    >
      {children}
    </Context.Provider>
  )
}

export function VideoPlaybackBatchButton({ imageIds }: { imageIds: number[] }) {
  const context = useContext(Context)
  if (!context) return null
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={!imageIds.length || context.busy}
      onClick={() => context.generate(imageIds)}
    >
      <Film data-icon="inline-start" />
      生成播放副本{imageIds.length ? ` (${imageIds.length})` : ''}
    </Button>
  )
}

export function VideoPlaybackEntry({ imageId }: { imageId: number }) {
  const context = useContext(Context)
  if (!context) return null
  const status = context.statuses.find((item) => item.imageId === imageId)
  const job = status?.job
  const running = !!job && active.has(job.status)
  return (
    <div className="flex min-w-0 flex-col gap-1" onClick={(event) => event.stopPropagation()}>
      {status?.copy && <Badge variant="secondary">播放副本 · {formatFileSize(status.copy.outputSize)}</Badge>}
      <div className="flex items-center gap-1">
        {running ? (
          <>
            <span className="text-xs">
              {formatBackgroundJobStatus(job.status)} {Math.round(job.progress)}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="取消播放副本生成"
              disabled={job.status === 'CANCELLING' || context.busy}
              onClick={() => context.cancel(job.id)}
            >
              <X />
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={context.busy}
            onClick={() => (job?.status === 'FAILED' ? context.retry(job.id) : context.generate([imageId]))}
          >
            {job?.status === 'FAILED' ? <RotateCcw data-icon="inline-start" /> : <Film data-icon="inline-start" />}
            {job?.status === 'FAILED' ? '重试副本' : status?.copy ? '重新生成' : '生成播放副本'}
          </Button>
        )}
        {status?.copy && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="清理播放副本，保留原片"
            disabled={running || context.busy}
            onClick={() => context.remove(imageId)}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {!running && job?.message && ['FAILED', 'SKIPPED', 'CANCELLED'].includes(job.status) && (
        <span className="max-w-52 text-xs text-muted-foreground">{job.message}</span>
      )}
    </div>
  )
}
