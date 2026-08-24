'use client'

import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleStop, Info, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { useTRPC } from '@/lib/trpc'

interface PixivTagEnrichmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStarted: () => void
  selectedTags: Array<{
    id: number
    name: string
    image: string
    checked: boolean
  }>
}

export function PixivTagEnrichmentDialog({
  open,
  onOpenChange,
  onStarted,
  selectedTags
}: PixivTagEnrichmentDialogProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const selectedTagIds = selectedTags.map((tag) => tag.id)
  const selectedMode = selectedTagIds.length > 0
  const summaryQuery = useQuery(
    trpc.tag.pixivEnrichmentSummary.queryOptions(undefined, {
      enabled: open,
      refetchInterval: (query) => (query.state.data?.activeJob ? 2_000 : 8_000)
    })
  )
  const startMutation = useMutation(
    trpc.tag.startPixivEnrichment.mutationOptions({
      onSuccess: ({ reused }) => {
        toast.success(
          reused
            ? '已有 Pixiv 标签补全任务正在运行'
            : selectedMode
              ? `已创建 ${selectedTagIds.length} 个标签的补全批次`
              : 'Pixiv 标签补全任务已创建'
        )
        queryClient.invalidateQueries({ queryKey: trpc.tag.pixivEnrichmentSummary.queryKey() })
        onStarted()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const cancelMutation = useMutation(
    trpc.tag.cancelPixivEnrichment.mutationOptions({
      onSuccess: ({ affectedCount }) => {
        toast.success(affectedCount ? '整批 Pixiv 标签补全已请求取消' : '任务已经结束')
        queryClient.invalidateQueries({ queryKey: trpc.tag.pixivEnrichmentSummary.queryKey() })
        onStarted()
      },
      onError: (error) => toast.error(error.message)
    })
  )

  const summary = summaryQuery.data
  const progress = summary?.children.total
    ? Math.round((summary.children.completed / summary.children.total) * 100)
    : (summary?.activeJob?.progress ?? 0)
  const active = Boolean(summary?.activeJob)
  const observedActiveBatch = useRef(false)

  useEffect(() => {
    if (active) {
      observedActiveBatch.current = true
      return
    }
    if (!observedActiveBatch.current) return

    observedActiveBatch.current = false
    onStarted()
  }, [active, onStarted])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>从 Pixiv 补全标签</DialogTitle>
          <DialogDescription>
            {selectedMode
              ? `重新查询已选择的 ${selectedTagIds.length} 个 Pixiv 来源标签。`
              : '查询尚未检查的 Pixiv 来源标签，并补充翻译、Pixpedia 简介和封面。'}
          </DialogDescription>
        </DialogHeader>

        {summaryQuery.isLoading ? (
          <div className="flex min-h-28 items-center justify-center text-muted-foreground">
            <Spinner />
          </div>
        ) : summaryQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>无法读取补全状态</AlertTitle>
            <AlertDescription>{summaryQuery.error.message}</AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-4">
            <Alert variant="info">
              <Info aria-hidden="true" />
              <AlertTitle>仅填充空字段</AlertTitle>
              <AlertDescription>
                {selectedMode
                  ? '所选标签即使检查过也会重新查询，但已有翻译、人工描述和封面仍不会被覆盖。'
                  : '已有翻译、人工描述和封面都不会被覆盖；已检查过的标签默认跳过。'}
              </AlertDescription>
            </Alert>

            {selectedMode ? (
              <SelectedTagSummary tags={selectedTags} />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryMetric label="待检查" value={summary?.candidateCount ?? 0} />
                <SummaryMetric label="成功" value={summary?.providerCounts.SUCCESS ?? 0} />
                <SummaryMetric label="部分成功" value={summary?.providerCounts.PARTIAL ?? 0} />
                <SummaryMetric label="失败" value={summary?.providerCounts.FAILED ?? 0} />
              </div>
            )}

            {active && (
              <div className="grid gap-2 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">任务执行中</span>
                  <Badge variant="secondary">{progress}%</Badge>
                </div>
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground">
                  {summary?.activeJob?.message || 'Worker 正在处理标签'}
                  {summary?.children.total ? `（${summary.children.completed}/${summary.children.total}）` : ''}
                </p>
              </div>
            )}

            {!active && summary?.latestBatch?.status === 'FAILED' && summary.latestBatch.error && (
              <Alert variant="destructive">
                <AlertTitle>最近一次批量任务失败</AlertTitle>
                <AlertDescription>{summary.latestBatch.error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          {active && (
            <Button variant="destructive" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CircleStop data-icon="inline-start" />
              )}
              {cancelMutation.isPending ? '正在取消整批任务' : '取消整批任务'}
            </Button>
          )}
          <Button
            onClick={() => startMutation.mutate({ tagIds: selectedMode ? selectedTagIds : undefined })}
            disabled={
              startMutation.isPending || summaryQuery.isLoading || active || (!selectedMode && !summary?.candidateCount)
            }
          >
            {startMutation.isPending ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
            {active ? '任务执行中' : selectedMode ? `补全已选 ${selectedTagIds.length} 项` : '开始补全'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SelectedTagSummary({ tags }: { tags: Array<{ id: number; name: string; image: string; checked: boolean }> }) {
  const visibleTags = tags.slice(0, 6)
  const remainingCount = tags.length - visibleTags.length

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/20 p-4">
      <div className="grid grid-cols-3 gap-3">
        <SummaryMetric label="本次选择" value={tags.length} compact />
        <SummaryMetric label="已有封面" value={tags.filter((tag) => tag.image).length} compact />
        <SummaryMetric label="已检查" value={tags.filter((tag) => tag.checked).length} compact />
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="已选择的标签">
        {visibleTags.map((tag) => (
          <Badge key={tag.id} variant="outline" className="max-w-40 truncate font-normal">
            {tag.name}
          </Badge>
        ))}
        {remainingCount > 0 && <Badge variant="secondary">另有 {remainingCount} 项</Badge>}
      </div>
    </div>
  )
}

function SummaryMetric({ label, value, compact = false }: { label: string; value: number; compact?: boolean }) {
  return (
    <div className={compact ? 'grid gap-1' : 'grid gap-1 rounded-lg border bg-muted/30 p-3'}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={compact ? 'text-lg font-semibold tabular-nums' : 'text-xl font-semibold tabular-nums'}>
        {value}
      </span>
    </div>
  )
}
