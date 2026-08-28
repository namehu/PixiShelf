'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'

export function ArchiveDefaultTagBackfillControl({
  hasDefaultTags,
  settingSaving
}: {
  hasDefaultTags: boolean
  settingSaving: boolean
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const statusQuery = useQuery(
    trpc.setting.getArchiveDefaultTagBackfillStatus.queryOptions(undefined, {
      refetchInterval: (query) => (query.state.data?.activeJob ? 2_000 : 15_000)
    })
  )
  const previewQuery = useQuery(
    trpc.setting.previewArchiveDefaultTagBackfill.queryOptions(undefined, {
      enabled: dialogOpen && !statusQuery.data?.activeJob,
      staleTime: 0
    })
  )
  const invalidateStatus = () =>
    queryClient.invalidateQueries({ queryKey: trpc.setting.getArchiveDefaultTagBackfillStatus.queryKey() })
  const startMutation = useMutation(
    trpc.setting.startArchiveDefaultTagBackfill.mutationOptions({
      onSuccess: (result) => {
        setDialogOpen(false)
        void invalidateStatus()
        toast.success(result.reused ? '已打开正在进行的历史归档标签补全任务' : '历史归档标签补全任务已创建')
      },
      onError: (error) => {
        toast.error(error.message)
        void previewQuery.refetch()
      }
    })
  )
  const cancelMutation = useMutation(
    trpc.setting.cancelArchiveDefaultTagBackfill.mutationOptions({
      onSuccess: () => {
        void invalidateStatus()
        toast.success('已请求取消历史归档标签补全')
      },
      onError: (error) => toast.error(error.message)
    })
  )

  const activeJob = statusQuery.data?.activeJob
  const latestJob = statusQuery.data?.latestJob
  const preview = previewQuery.data
  const capabilityAvailable = statusQuery.data?.capabilityAvailable ?? false
  const disabledReason = settingSaving
    ? '等待归档默认标签保存完成后再补全历史数据。'
    : !hasDefaultTags
      ? '请先选择至少一个归档默认标签。'
      : statusQuery.isLoading
        ? '正在确认 Worker 能力。'
        : !capabilityAvailable
          ? '当前 READY Worker 尚不支持历史归档标签补全。'
          : null

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border/70 pt-4">
      {activeJob ? (
        <ActiveBackfillProgress
          job={activeJob}
          cancelling={cancelMutation.isPending}
          onCancel={() => cancelMutation.mutate({ jobId: activeJob.id })}
        />
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">历史归档标签</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              只为正常展示的链接归档作品追加当前默认标签，不会删除原标签或重新下载媒体。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            disabled={Boolean(disabledReason)}
            onClick={() => setDialogOpen(true)}
          >
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            补全历史归档标签
          </Button>
        </div>
      )}

      {!activeJob && disabledReason ? <p className="text-xs text-muted-foreground">{disabledReason}</p> : null}
      {!activeJob && latestJob ? <LatestBackfillSummary job={latestJob} /> : null}

      <AlertDialog open={dialogOpen} onOpenChange={(open) => !startMutation.isPending && setDialogOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>补全历史归档标签？</AlertDialogTitle>
            <AlertDialogDescription>
              任务会冻结本次预览的标签与作品范围，分批追加缺失关系。已存在的关系会跳过，取消后也可以安全重跑。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-4">
            {previewQuery.isLoading ? (
              <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Spinner /> 正在统计历史归档作品…
              </div>
            ) : previewQuery.error ? (
              <Alert variant="destructive" role="alert">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>无法生成补全预览</AlertTitle>
                <AlertDescription>{previewQuery.error.message}</AlertDescription>
              </Alert>
            ) : preview ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="历史归档标签补全预览">
                  <PreviewFact label="目标作品" value={preview.targetArtworkCount} />
                  <PreviewFact label="有效标签" value={preview.validTagIds.length} />
                  <PreviewFact label="已有关系" value={preview.existingRelations} />
                  <PreviewFact label="预计新增" value={preview.missingRelations} accent />
                </div>
                {preview.unavailableTagIds.length > 0 ? (
                  <Alert variant="warning">
                    <AlertTriangle aria-hidden="true" />
                    <AlertTitle>部分标签已经不存在</AlertTitle>
                    <AlertDescription>
                      标签 ID {preview.unavailableTagIds.join('、')} 会跳过，不会自动重新创建。
                    </AlertDescription>
                  </Alert>
                ) : null}
                <p className="text-sm leading-6 text-muted-foreground">
                  任务使用最低手动优先级，并在每个持久批次后让出 Writer；新的归档导入可以优先执行。
                </p>
              </>
            ) : null}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={startMutation.isPending}>返回检查</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                startMutation.isPending ||
                !preview ||
                preview.validTagIds.length === 0 ||
                preview.missingRelations === 0
              }
              onClick={(event) => {
                event.preventDefault()
                if (preview) startMutation.mutate({ snapshotDigest: preview.snapshotDigest })
              }}
            >
              {startMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
              {startMutation.isPending ? '正在创建任务…' : preview?.missingRelations === 0 ? '无需补全' : '确认补全'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ActiveBackfillProgress({
  job,
  cancelling,
  onCancel
}: {
  job: {
    id: string
    status: string
    progress: number
    message: string | null
    checkpoint: {
      processedArtworks: number
      addedRelations: number
      existingRelations: number
    } | null
  }
  cancelling: boolean
  onCancel: () => void
}) {
  const yielding = job.status === 'RETRY_WAIT'
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/[0.035] p-3" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">正在补全历史归档标签</p>
          <Badge variant={yielding ? 'muted' : 'info'}>
            {yielding ? '批次间让出 Worker' : statusLabel(job.status)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/tasks">
              查看后台任务 <ExternalLink data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={cancelling || job.status === 'CANCELLING'}
            onClick={onCancel}
          >
            {cancelling || job.status === 'CANCELLING' ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <X data-icon="inline-start" aria-hidden="true" />
            )}
            {cancelling || job.status === 'CANCELLING' ? '正在取消…' : '取消补全'}
          </Button>
        </div>
      </div>
      <Progress className="mt-3 h-1.5" value={job.progress} aria-label={`历史归档标签补全进度 ${job.progress}%`} />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>进度 {job.progress}%</span>
        <span>已检查 {job.checkpoint?.processedArtworks ?? 0}</span>
        <span>新增关系 {job.checkpoint?.addedRelations ?? 0}</span>
        <span>已存在 {job.checkpoint?.existingRelations ?? 0}</span>
      </div>
      {job.message ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{job.message}</p> : null}
    </div>
  )
}

function LatestBackfillSummary({
  job
}: {
  job: {
    status: string
    message: string | null
    error: string | null
    result: {
      processedArtworks: number
      addedRelations: number
      existingRelations: number
      skippedArtworks: number
      failedArtworks: number
      skippedTagIds: number[]
    } | null
  }
}) {
  if (!['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(job.status)) return null
  return (
    <div className="rounded-md bg-muted/45 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">最近一次：{statusLabel(job.status)}</span>
        {job.result ? (
          <>
            <span>检查 {job.result.processedArtworks}</span>
            <span>新增 {job.result.addedRelations}</span>
            <span>已存在 {job.result.existingRelations}</span>
            <span>跳过 {job.result.skippedArtworks}</span>
            <span>失败 {job.result.failedArtworks}</span>
          </>
        ) : null}
      </div>
      {job.result?.skippedTagIds.length ? (
        <p className="mt-1">已跳过标签 ID：{job.result.skippedTagIds.join('、')}</p>
      ) : null}
      {job.error || job.message ? <p className="mt-1 leading-5">{job.error || job.message}</p> : null}
    </div>
  )
}

function PreviewFact({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-muted/35 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={
          accent ? 'mt-1 text-lg font-semibold tabular-nums text-primary' : 'mt-1 text-lg font-semibold tabular-nums'
        }
      >
        {value.toLocaleString('zh-CN')}
      </p>
    </div>
  )
}

function statusLabel(status: string) {
  return (
    {
      PENDING: '排队中',
      RETRY_WAIT: '等待下一批',
      RUNNING: '执行中',
      PAUSING: '暂停中',
      PAUSED: '已暂停',
      CANCELLING: '取消中',
      COMPLETED: '已完成',
      FAILED: '失败',
      CANCELLED: '已取消',
      SKIPPED: '已跳过'
    }[status] ?? status
  )
}
