'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleStop, Clock3, Info, Sparkles } from 'lucide-react'
import { PIXIV_ARTWORK_ENRICHMENT_BATCH_LIMIT } from '@pixishelf/job-contracts'
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

interface SelectedArtwork {
  id: number
  title: string
  checked: boolean
}

interface PixivArtworkEnrichmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStatusChanged: () => void
  selectedArtworks: SelectedArtwork[]
}

export function PixivArtworkEnrichmentDialog({
  open,
  onOpenChange,
  onStatusChanged,
  selectedArtworks
}: PixivArtworkEnrichmentDialogProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [submittedSelection, setSubmittedSelection] = useState<SelectedArtwork[] | null>(null)
  const [submittedBatchId, setSubmittedBatchId] = useState<string | null>(null)
  const [refreshExisting, setRefreshExisting] = useState(false)
  const trackedBatchId = useRef<string | null>(null)
  const reportedFinishedBatch = useRef<string | null>(null)
  const summaryQuery = useQuery(
    trpc.artwork.pixivEnrichmentSummary.queryOptions(undefined, {
      enabled: open,
      refetchInterval: (query) => (query.state.data?.activeJob ? 2_000 : 8_000)
    })
  )
  const startMutation = useMutation(
    trpc.artwork.startPixivEnrichment.mutationOptions({
      onSuccess: ({ reused, job }) => {
        toast.success(
          reused
            ? '已有 Pixiv 作品同步任务正在运行'
            : selectedArtworks.length
              ? `已创建 ${selectedArtworks.length} 个作品的${refreshExisting ? '刷新' : '同步'}批次`
              : `Pixiv 作品全量${refreshExisting ? '刷新' : '同步'}任务已创建`
        )
        if (!reused) {
          trackedBatchId.current = job.id
          setSubmittedSelection(selectedArtworks)
          setSubmittedBatchId(job.id)
          onStatusChanged()
        }
        queryClient.invalidateQueries({ queryKey: trpc.artwork.pixivEnrichmentSummary.queryKey() })
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const cancelMutation = useMutation(
    trpc.artwork.cancelPixivEnrichment.mutationOptions({
      onSuccess: ({ affectedCount }) => {
        toast.success(affectedCount ? '整批 Pixiv 作品同步已请求取消' : '任务已经结束')
        queryClient.invalidateQueries({ queryKey: trpc.artwork.pixivEnrichmentSummary.queryKey() })
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
  const hasBatchSession = submittedSelection !== null || Boolean(sessionBatchId) || active
  const displayedArtworks = submittedSelection ?? (hasBatchSession ? [] : selectedArtworks)
  const selectedArtworkIds = displayedArtworks.map((artwork) => artwork.id)
  const selectedMode = selectedArtworkIds.length > 0
  const selectionExceedsLimit = selectedArtworkIds.length > PIXIV_ARTWORK_ENRICHMENT_BATCH_LIMIT
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
          <DialogTitle>从 Pixiv 同步作品</DialogTitle>
          <DialogDescription>
            {selectedMode
              ? `重新查询已选择的 ${selectedArtworkIds.length} 个作品。`
              : refreshExisting
                ? '查询并连续刷新全部具有唯一 Pixiv 身份的作品。'
                : '查询并连续同步全部尚未检查的 Pixiv 作品。'}
          </DialogDescription>
        </DialogHeader>

        {summaryQuery.isLoading ? (
          <div className="flex min-h-28 items-center justify-center text-muted-foreground">
            <Spinner />
          </div>
        ) : summaryQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>无法读取同步状态</AlertTitle>
            <AlertDescription>{summaryQuery.error.message}</AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-4">
            {!summary?.capabilityAvailable ? (
              <Alert variant="destructive">
                <Info aria-hidden="true" />
                <AlertTitle>Worker 尚未就绪</AlertTitle>
                <AlertDescription>当前 READY Worker 不支持 Pixiv 作品在线同步，请先部署新 Worker。</AlertDescription>
              </Alert>
            ) : (
              <Alert variant={selectionExceedsLimit || refreshExisting ? 'warning' : 'info'}>
                <Info aria-hidden="true" />
                <AlertTitle>
                  {selectionExceedsLimit
                    ? '选择数量超过限制'
                    : refreshExisting
                      ? '刷新已有资料'
                      : '按默认策略补全'}
                </AlertTitle>
                <AlertDescription>
                  {selectionExceedsLimit
                    ? `一次最多选择 ${PIXIV_ARTWORK_ENRICHMENT_BATCH_LIMIT} 个作品。`
                    : refreshExisting
                      ? selectedMode
                        ? '将刷新所选作品的 Pixiv 来源资料、标签、标题和描述；任务期间新发生的人工修改仍会保留。'
                        : `当前 ${availableCount} 个 Pixiv 作品会全部刷新，包括来源资料、标签、标题和描述；Worker 每次只处理一个作品。`
                      : selectedMode
                        ? '将按默认策略同步所选作品：更新来源资料和标签，仅更新未被人工修改的标题和描述。'
                        : `当前 ${availableCount} 个未检查作品会按每页 ${PIXIV_ARTWORK_ENRICHMENT_BATCH_LIMIT} 个发现并全部排入持久队列；已有人工标题和描述不会被覆盖。`}
                </AlertDescription>
              </Alert>
            )}

            <FieldGroup className="gap-3">
              <Field orientation="horizontal">
                <Checkbox
                  id="pixiv-artwork-refresh-existing"
                  checked={refreshExisting}
                  disabled={active || hasBatchSession}
                  onCheckedChange={(checked) => setRefreshExisting(checked === true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor="pixiv-artwork-refresh-existing">刷新已有资料</FieldLabel>
                  <FieldDescription>
                    {selectedMode
                      ? '重新获取并刷新所选作品的全部 Pixiv 资料，包括标题和描述。'
                      : '重新获取并刷新全部 Pixiv 作品的资料，包括标题和描述；未开启时只补全尚未检查的作品。'}
                  </FieldDescription>
                </FieldContent>
              </Field>
            </FieldGroup>

            {selectedMode ? (
              <SelectedArtworkSummary artworks={displayedArtworks} />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <SummaryMetric label="待检查" value={summary?.candidateCount ?? 0} />
                <SummaryMetric label="成功" value={summary?.providerCounts.SUCCESS ?? 0} />
                <SummaryMetric label="部分成功" value={summary?.providerCounts.PARTIAL ?? 0} />
                <SummaryMetric label="无数据" value={summary?.providerCounts.NO_DATA ?? 0} />
                <SummaryMetric label="失败" value={summary?.providerCounts.FAILED ?? 0} />
              </div>
            )}

            {active ? (
              <div className="grid gap-2 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">任务执行中</span>
                  <Badge variant="secondary">{progress}%</Badge>
                </div>
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground">
                  {activeMessage || 'Worker 正在处理作品'}
                  {summary?.children.total ? `（${summary.children.completed}/${summary.children.total}）` : ''}
                  {' 关闭页面不影响后台执行。'}
                </p>
              </div>
            ) : null}

            {hasBatchSession && !active && !submittedBatchFinished ? (
              <Alert>
                <Clock3 aria-hidden="true" />
                <AlertTitle>任务已提交</AlertTitle>
                <AlertDescription>正在等待 Worker 领取任务。</AlertDescription>
              </Alert>
            ) : null}

            {submittedBatchFinished ? (
              <FinishedAlert
                status={summary?.latestBatch?.status ?? 'COMPLETED'}
                failedCount={summary?.children.byStatus.FAILED ?? 0}
                cancelledCount={summary?.children.byStatus.CANCELLED ?? 0}
              />
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            关闭
          </Button>
          {active ? (
            <Button variant="destructive" onClick={() => cancelMutation.mutate({})} disabled={cancelMutation.isPending}>
              {cancelMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CircleStop data-icon="inline-start" />
              )}
              {cancelMutation.isPending ? '正在取消整批任务' : '取消整批任务'}
            </Button>
          ) : null}
          {!active && !hasBatchSession ? (
            <Button
              onClick={() =>
                startMutation.mutate({
                  artworkIds: selectedMode ? selectedArtworkIds : undefined,
                  refreshExisting
                })
              }
              disabled={
                startMutation.isPending ||
                summaryQuery.isLoading ||
                !summary?.capabilityAvailable ||
                selectionExceedsLimit ||
                (!selectedMode && !availableCount)
              }
            >
              {startMutation.isPending ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
              {selectedMode
                ? `${refreshExisting ? '刷新' : '同步'}已选 ${selectedArtworkIds.length} 项`
                : `连续${refreshExisting ? '刷新' : '同步'}全部（${availableCount} 个）`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SelectedArtworkSummary({ artworks }: { artworks: SelectedArtwork[] }) {
  const visible = artworks.slice(0, 6)
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/20 p-4">
      <div className="grid grid-cols-2 gap-3">
        <SummaryMetric label="本次选择" value={artworks.length} />
        <SummaryMetric label="已检查" value={artworks.filter((artwork) => artwork.checked).length} />
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="已选择的作品">
        {visible.map((artwork) => (
          <Badge key={artwork.id} variant="outline" className="max-w-48 truncate font-normal">
            {artwork.title}
          </Badge>
        ))}
        {artworks.length > visible.length ? (
          <Badge variant="secondary">另有 {artworks.length - visible.length} 项</Badge>
        ) : null}
      </div>
    </div>
  )
}

function FinishedAlert({
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
        <AlertTitle>本次同步已结束</AlertTitle>
        <AlertDescription>
          {failedCount ? `${failedCount} 个作品处理失败，可在列表中单独重试。` : '批次执行失败。'}
        </AlertDescription>
      </Alert>
    )
  }
  if (status === 'CANCELLED' || cancelledCount > 0) {
    return (
      <Alert variant="warning">
        <CircleStop aria-hidden="true" />
        <AlertTitle>本次同步已停止</AlertTitle>
        <AlertDescription>未完成的作品没有继续处理。</AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert variant="success">
      <CheckCircle2 aria-hidden="true" />
      <AlertTitle>本次同步已完成</AlertTitle>
      <AlertDescription>作品列表已刷新。</AlertDescription>
    </Alert>
  )
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
