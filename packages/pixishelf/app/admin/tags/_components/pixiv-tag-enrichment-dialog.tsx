'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleStop, Clock3, Info, Sparkles } from 'lucide-react'
import { PIXIV_TAG_ENRICHMENT_BATCH_LIMIT } from '@pixishelf/job-contracts'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { useTRPC } from '@/lib/trpc'

const ACTIVE_BATCH_STATUSES = new Set(['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'])

interface PixivTagEnrichmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onBatchStarted: () => void
  onStatusChanged: () => void
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
  onBatchStarted,
  onStatusChanged,
  selectedTags
}: PixivTagEnrichmentDialogProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [submittedSelection, setSubmittedSelection] = useState<typeof selectedTags | null>(null)
  const [submittedBatchId, setSubmittedBatchId] = useState<string | null>(null)
  const [refreshExisting, setRefreshExisting] = useState(false)
  const hasSubmitted = submittedSelection !== null
  const trackedBatchId = useRef<string | null>(null)
  const reportedFinishedBatch = useRef<string | null>(null)
  const summaryQuery = useQuery(
    trpc.tag.pixivEnrichmentSummary.queryOptions(undefined, {
      enabled: open,
      refetchInterval: (query) => (query.state.data?.activeJob ? 2_000 : 8_000)
    })
  )
  const startMutation = useMutation(
    trpc.tag.startPixivEnrichment.mutationOptions({
      onSuccess: ({ reused, job }) => {
        const requestedTagIds = selectedTags.map((tag) => tag.id)
        toast.success(
          reused
            ? '已有 Pixiv 标签补全任务正在运行'
            : requestedTagIds.length
              ? `已创建 ${requestedTagIds.length} 个标签的${refreshExisting ? '刷新' : '补全'}批次`
              : `Pixiv 标签全量${refreshExisting ? '刷新' : '补全'}任务已创建`
        )
        if (!reused) {
          trackedBatchId.current = job.id
          setSubmittedSelection(selectedTags)
          setSubmittedBatchId(job.id)
          onBatchStarted()
        }
        queryClient.invalidateQueries({ queryKey: trpc.tag.pixivEnrichmentSummary.queryKey() })
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const cancelMutation = useMutation(
    trpc.tag.cancelPixivEnrichment.mutationOptions({
      onSuccess: ({ affectedCount }) => {
        toast.success(affectedCount ? '整批 Pixiv 标签补全已请求取消' : '任务已经结束')
        queryClient.invalidateQueries({ queryKey: trpc.tag.pixivEnrichmentSummary.queryKey() })
        onStatusChanged()
      },
      onError: (error) => toast.error(error.message)
    })
  )

  const summary = summaryQuery.data
  const discoveryActive = Boolean(
    summary?.latestBatch?.stage === 'DISCOVERING' && ACTIVE_BATCH_STATUSES.has(summary.latestBatch.status)
  )
  const progress = discoveryActive
    ? (summary?.latestBatch?.progress ?? 0)
    : summary?.children.total
      ? Math.round((summary.children.completed / summary.children.total) * 100)
      : (summary?.activeJob?.progress ?? 0)
  const activeMessage = discoveryActive ? summary?.latestBatch?.message : summary?.activeJob?.message
  const active = Boolean(summary?.activeJob)
  const sessionBatchId = submittedBatchId ?? trackedBatchId.current
  const hasBatchSession = hasSubmitted || Boolean(sessionBatchId) || active
  const displayedTags = submittedSelection ?? (hasBatchSession ? [] : selectedTags)
  const selectedTagIds = displayedTags.map((tag) => tag.id)
  const selectedMode = selectedTagIds.length > 0
  const selectionExceedsLimit = selectedMode && selectedTagIds.length > PIXIV_TAG_ENRICHMENT_BATCH_LIMIT
  const availableCount = refreshExisting ? (summary?.eligibleCount ?? 0) : (summary?.candidateCount ?? 0)
  const submittedBatchFinished = Boolean(
    sessionBatchId &&
      !active &&
      summary?.latestBatch?.id === sessionBatchId &&
      ['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(summary.latestBatch.status)
  )

  useEffect(() => {
    if (!summary?.activeJob || trackedBatchId.current) return
    trackedBatchId.current = summary.activeJob.parentJobId ?? summary.activeJob.id
  }, [summary?.activeJob])

  useEffect(() => {
    if (!submittedBatchFinished || !sessionBatchId || reportedFinishedBatch.current === sessionBatchId) return

    reportedFinishedBatch.current = sessionBatchId
    onStatusChanged()
  }, [onStatusChanged, sessionBatchId, submittedBatchFinished])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSubmittedSelection(null)
      setSubmittedBatchId(null)
      setRefreshExisting(false)
      trackedBatchId.current = null
      reportedFinishedBatch.current = null
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>从 Pixiv 补全标签</DialogTitle>
          <DialogDescription>
            {selectedMode
              ? `重新查询已选择的 ${selectedTagIds.length} 个 Pixiv 来源标签。`
              : refreshExisting
                ? '查询并连续刷新全部 Pixiv 来源标签。'
                : '查询并连续补全全部尚未检查的 Pixiv 来源标签。'}
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
            <Alert variant={selectionExceedsLimit || refreshExisting ? 'warning' : 'info'}>
              <Info aria-hidden="true" />
              <AlertTitle>
                {selectionExceedsLimit
                  ? '选择数量超过限制'
                  : refreshExisting
                    ? '刷新已有资料'
                    : selectedMode
                      ? '仅填充空字段'
                      : '连续补全全部待检查标签'}
              </AlertTitle>
              <AlertDescription>
                {selectionExceedsLimit
                  ? `一次最多选择 ${PIXIV_TAG_ENRICHMENT_BATCH_LIMIT} 个标签，当前已选择 ${selectedTagIds.length} 个。`
                  : refreshExisting
                    ? selectedMode
                      ? '将使用 Pixiv 最新中文翻译、英文翻译、Pixpedia 简介和封面刷新所选标签；Pixiv 未返回或下载失败的字段保留现值，标签原名和人工描述不变。'
                      : `当前 ${summary?.eligibleCount ?? 0} 个 Pixiv 来源标签会全部排入持久队列；Pixiv 未返回或下载失败的字段保留现值，标签原名和人工描述不变。`
                    : selectedMode
                      ? '所选标签即使检查过也会重新查询，但已有翻译、Pixpedia 简介、人工描述和封面仍不会被覆盖。'
                      : `当前 ${summary?.candidateCount ?? 0} 个候选会按每页 ${PIXIV_TAG_ENRICHMENT_BATCH_LIMIT} 个发现并全部排入持久队列；关闭页面不影响执行，已有字段不会被覆盖。`}
              </AlertDescription>
            </Alert>

            <FieldGroup className="gap-3">
              <Field orientation="horizontal">
                <Checkbox
                  id="pixiv-tag-refresh-existing"
                  checked={refreshExisting}
                  disabled={active || hasBatchSession}
                  onCheckedChange={(checked) => setRefreshExisting(checked === true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor="pixiv-tag-refresh-existing">刷新已有资料</FieldLabel>
                  <FieldDescription>
                    使用 Pixiv 最新翻译、Pixpedia 简介和封面替换现值；标签原名和人工描述不变。
                  </FieldDescription>
                </FieldContent>
              </Field>
            </FieldGroup>

            {selectedMode ? (
              <SelectedTagSummary tags={displayedTags} />
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
                  {activeMessage || 'Worker 正在处理标签'}
                  {summary?.children.total ? `（${summary.children.completed}/${summary.children.total}）` : ''}
                  {' 关闭页面不影响后台执行。'}
                </p>
              </div>
            )}

            {hasBatchSession && !active && !submittedBatchFinished && (
              <Alert>
                <Clock3 aria-hidden="true" />
                <AlertTitle>任务已提交</AlertTitle>
                <AlertDescription>正在等待 Worker 领取任务。</AlertDescription>
              </Alert>
            )}

            {submittedBatchFinished && (
              <BatchFinishedAlert
                status={summary?.latestBatch?.status ?? 'COMPLETED'}
                failedCount={summary?.children.byStatus.FAILED ?? 0}
                cancelledCount={summary?.children.byStatus.CANCELLED ?? 0}
              />
            )}

            {!hasBatchSession && !active && summary?.latestBatch?.status === 'FAILED' && summary.latestBatch.error && (
              <Alert variant="destructive">
                <AlertTitle>最近一次批量任务失败</AlertTitle>
                <AlertDescription>{summary.latestBatch.error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
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
          {!active && !hasBatchSession && (
            <Button
              onClick={() =>
                startMutation.mutate({
                  tagIds: selectedMode ? selectedTagIds : undefined,
                  refreshExisting
                })
              }
              disabled={
                startMutation.isPending ||
                summaryQuery.isLoading ||
                selectionExceedsLimit ||
                (!selectedMode && !availableCount)
              }
            >
              {startMutation.isPending ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
              {selectionExceedsLimit
                ? `已选 ${selectedTagIds.length} 项（最多 ${PIXIV_TAG_ENRICHMENT_BATCH_LIMIT} 项）`
                : selectedMode
                  ? `${refreshExisting ? '刷新' : '补全'}已选 ${selectedTagIds.length} 项`
                  : `连续${refreshExisting ? '刷新' : '补全'}全部（${availableCount} 个）`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BatchFinishedAlert({
  status,
  failedCount,
  cancelledCount
}: {
  status: string
  failedCount: number
  cancelledCount: number
}) {
  if (status === 'FAILED' || failedCount > 0) {
    return (
      <Alert variant="warning">
        <Info aria-hidden="true" />
        <AlertTitle>本次补全已结束</AlertTitle>
        <AlertDescription>
          {failedCount ? `${failedCount} 个标签处理失败，可在列表中重新选择。` : '批次执行失败。'}
        </AlertDescription>
      </Alert>
    )
  }

  if (status === 'CANCELLED' || cancelledCount > 0) {
    return (
      <Alert variant="warning">
        <CircleStop aria-hidden="true" />
        <AlertTitle>本次补全已停止</AlertTitle>
        <AlertDescription>未完成的标签没有继续处理。</AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="success">
      <CheckCircle2 aria-hidden="true" />
      <AlertTitle>本次补全已完成</AlertTitle>
      <AlertDescription>列表中的翻译、简介和封面状态已刷新。</AlertDescription>
    </Alert>
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
