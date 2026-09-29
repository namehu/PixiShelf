'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleStop, Clock3, Info, LibraryBig } from 'lucide-react'
import { PIXIV_SERIES_RECONCILIATION_BATCH_LIMIT } from '@pixishelf/job-contracts'
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
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

const ACTIVE_BATCH_STATUSES = new Set(['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'])

interface PixivSeriesReconciliationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStatusChanged: () => void
}

export function PixivSeriesReconciliationDialog({
  open,
  onOpenChange,
  onStatusChanged
}: PixivSeriesReconciliationDialogProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [refreshExisting, setRefreshExisting] = useState(false)
  const [submittedBatchId, setSubmittedBatchId] = useState<string | null>(null)
  const trackedBatchId = useRef<string | null>(null)
  const reportedFinishedBatch = useRef<string | null>(null)
  const summaryQuery = useQuery(
    trpc.series.pixivReconciliationSummary.queryOptions(undefined, {
      enabled: open,
      refetchInterval: (query) => (query.state.data?.activeJob ? 2_000 : 8_000)
    })
  )
  const startMutation = useMutation(
    trpc.series.startPixivReconciliation.mutationOptions({
      onSuccess: ({ reused, job }) => {
        toast.success(reused ? '已有 Pixiv 系列核对任务正在运行' : 'Pixiv 系列核对任务已创建')
        if (!reused) {
          trackedBatchId.current = job.id
          setSubmittedBatchId(job.id)
          onStatusChanged()
        }
        queryClient.invalidateQueries({ queryKey: trpc.series.pixivReconciliationSummary.queryKey() })
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const cancelMutation = useMutation(
    trpc.series.cancelPixivReconciliation.mutationOptions({
      onSuccess: ({ affectedCount }) => {
        toast.success(affectedCount ? '整批 Pixiv 系列核对已请求取消' : '任务已经结束')
        queryClient.invalidateQueries({ queryKey: trpc.series.pixivReconciliationSummary.queryKey() })
        onStatusChanged()
      },
      onError: (error) => toast.error(error.message)
    })
  )

  const summary = summaryQuery.data
  const active = Boolean(summary?.activeJob)
  const discoveryActive = Boolean(
    summary?.latestBatch?.stage === 'DISCOVERING' && ACTIVE_BATCH_STATUSES.has(summary.latestBatch.status)
  )
  const progress = discoveryActive
    ? (summary?.latestBatch?.progress ?? 0)
    : summary?.children.total
      ? Math.round((summary.children.completed / summary.children.total) * 100)
      : (summary?.activeJob?.progress ?? 0)
  const activeMessage = discoveryActive ? summary?.latestBatch?.message : summary?.activeJob?.message
  const sessionBatchId = submittedBatchId ?? trackedBatchId.current
  const hasBatchSession = Boolean(sessionBatchId) || active
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
      setRefreshExisting(false)
      setSubmittedBatchId(null)
      trackedBatchId.current = null
      reportedFinishedBatch.current = null
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>核对 Pixiv 系列</DialogTitle>
          <DialogDescription>
            {refreshExisting
              ? '重新读取全部 Pixiv 作品，刷新来源系列、标题和作品顺序。'
              : '读取尚未核对的 Pixiv 作品，建立准确的系列来源与成员关系。'}
          </DialogDescription>
        </DialogHeader>

        {summaryQuery.isLoading ? (
          <div className="flex min-h-28 items-center justify-center text-muted-foreground">
            <Spinner />
          </div>
        ) : summaryQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>无法读取系列核对状态</AlertTitle>
            <AlertDescription>
              <PrivacySensitiveText>{summaryQuery.error.message}</PrivacySensitiveText>
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-4">
            {!summary?.capabilityAvailable ? (
              <Alert variant="warning">
                <Info aria-hidden="true" />
                <AlertTitle>Worker 尚未就绪</AlertTitle>
                <AlertDescription>请先部署并启动包含 Pixiv 系列能力的新版本 Worker。</AlertDescription>
              </Alert>
            ) : null}

            <Alert variant={refreshExisting ? 'warning' : 'info'}>
              <LibraryBig aria-hidden="true" />
              <AlertTitle>{refreshExisting ? '刷新来源资料' : '只核对未检查作品'}</AlertTitle>
              <AlertDescription>
                {refreshExisting
                  ? `全部 ${summary?.eligibleCount ?? 0} 个有效 Pixiv 作品会按最久未检查顺序处理；来源标题和顺序将恢复为 Pixiv 最新值，手工系列关系不会删除。`
                  : `当前 ${summary?.candidateCount ?? 0} 个作品会按每页 ${PIXIV_SERIES_RECONCILIATION_BATCH_LIMIT} 个发现并全部排队；同名系列不会自动合并，手工系列关系不会删除。`}
                {' Worker 始终逐个处理，关闭页面不影响执行。'}
              </AlertDescription>
            </Alert>

            <FieldGroup className="gap-3">
              <Field orientation="horizontal">
                <Checkbox
                  id="pixiv-series-refresh-existing"
                  checked={refreshExisting}
                  disabled={active || hasBatchSession}
                  onCheckedChange={(checked) => setRefreshExisting(checked === true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor="pixiv-series-refresh-existing">刷新已有系列资料</FieldLabel>
                  <FieldDescription>采用 Pixiv 最新系列标题和作品顺序；本地手工系列与成员关系保持不变。</FieldDescription>
                </FieldContent>
              </Field>
            </FieldGroup>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <SummaryMetric label="待核对作品" value={summary?.candidateCount ?? 0} />
              <SummaryMetric label="成功" value={summary?.providerCounts.SUCCESS ?? 0} />
              <SummaryMetric label="部分成功" value={summary?.providerCounts.PARTIAL ?? 0} />
              <SummaryMetric label="无系列" value={summary?.providerCounts.NO_DATA ?? 0} />
              <SummaryMetric label="失败" value={summary?.providerCounts.FAILED ?? 0} />
            </div>

            {active ? (
              <div className="grid gap-2 rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">任务执行中</span>
                  <Badge variant="secondary">{progress}%</Badge>
                </div>
                <Progress value={progress} />
                <p className="text-xs text-muted-foreground">
                  {activeMessage || 'Worker 正在核对系列'}
                  {summary?.children.total ? `（${summary.children.completed}/${summary.children.total}）` : ''}
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
              {cancelMutation.isPending ? <Spinner data-icon="inline-start" /> : <CircleStop data-icon="inline-start" />}
              {cancelMutation.isPending ? '正在取消整批任务' : '取消整批任务'}
            </Button>
          ) : null}
          {!active && !hasBatchSession ? (
            <Button
              onClick={() => startMutation.mutate({ refreshExisting })}
              disabled={
                startMutation.isPending ||
                summaryQuery.isLoading ||
                !summary?.capabilityAvailable ||
                availableCount === 0
              }
            >
              {startMutation.isPending ? <Spinner data-icon="inline-start" /> : <LibraryBig data-icon="inline-start" />}
              连续{refreshExisting ? '刷新' : '核对'}全部（{availableCount} 个）
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FinishedAlert({ status, failedCount, cancelledCount }: { status: string; failedCount: number; cancelledCount: number }) {
  if (status === 'FAILED' || failedCount > 0) {
    return (
      <Alert variant="warning">
        <Info aria-hidden="true" />
        <AlertTitle>本次核对已结束</AlertTitle>
        <AlertDescription>{failedCount ? `${failedCount} 个作品处理失败，可从任务中心重试。` : '批次执行失败。'}</AlertDescription>
      </Alert>
    )
  }
  if (status === 'CANCELLED' || cancelledCount > 0) {
    return (
      <Alert variant="warning">
        <CircleStop aria-hidden="true" />
        <AlertTitle>本次核对已停止</AlertTitle>
        <AlertDescription>未完成的作品没有继续处理。</AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert variant="success">
      <CheckCircle2 aria-hidden="true" />
      <AlertTitle>本次核对已完成</AlertTitle>
      <AlertDescription>系列来源、标题和成员顺序状态已更新。</AlertDescription>
    </Alert>
  )
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid gap-1 rounded-lg border bg-muted/30 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  )
}
