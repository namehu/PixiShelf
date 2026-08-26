'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleStop, Clock3, Info, Sparkles } from 'lucide-react'
import { PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT } from '@pixishelf/job-contracts'
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

interface SelectedArtist {
  id: number
  name: string
  checked: boolean
}

interface PixivArtistEnrichmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onStatusChanged: () => void
  selectedArtists: SelectedArtist[]
}

export function PixivArtistEnrichmentDialog({
  open,
  onOpenChange,
  onStatusChanged,
  selectedArtists
}: PixivArtistEnrichmentDialogProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [submittedSelection, setSubmittedSelection] = useState<SelectedArtist[] | null>(null)
  const [submittedBatchId, setSubmittedBatchId] = useState<string | null>(null)
  const [refreshExisting, setRefreshExisting] = useState(false)
  const trackedBatchId = useRef<string | null>(null)
  const reportedFinishedBatch = useRef<string | null>(null)
  const summaryQuery = useQuery(
    trpc.artist.pixivEnrichmentSummary.queryOptions(undefined, {
      enabled: open,
      refetchInterval: (query) => (query.state.data?.activeJob ? 2_000 : 8_000)
    })
  )
  const startMutation = useMutation(
    trpc.artist.startPixivEnrichment.mutationOptions({
      onSuccess: ({ reused, job }) => {
        toast.success(
          reused
            ? '已有 Pixiv 艺术家补全任务正在运行'
            : selectedArtists.length
              ? `已创建 ${selectedArtists.length} 个艺术家的补全批次`
              : `Pixiv 艺术家全量${refreshExisting ? '刷新' : '补全'}任务已创建`
        )
        if (!reused) {
          trackedBatchId.current = job.id
          setSubmittedSelection(selectedArtists)
          setSubmittedBatchId(job.id)
          onStatusChanged()
        }
        queryClient.invalidateQueries({ queryKey: trpc.artist.pixivEnrichmentSummary.queryKey() })
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const cancelMutation = useMutation(
    trpc.artist.cancelPixivEnrichment.mutationOptions({
      onSuccess: ({ affectedCount }) => {
        toast.success(affectedCount ? '整批 Pixiv 艺术家补全已请求取消' : '任务已经结束')
        queryClient.invalidateQueries({ queryKey: trpc.artist.pixivEnrichmentSummary.queryKey() })
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
  const displayedArtists = submittedSelection ?? (hasBatchSession ? [] : selectedArtists)
  const selectedArtistIds = displayedArtists.map((artist) => artist.id)
  const selectedMode = selectedArtistIds.length > 0
  const selectionExceedsLimit = selectedArtistIds.length > PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT
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
          <DialogTitle>从 Pixiv 补全艺术家</DialogTitle>
          <DialogDescription>
            {selectedMode
              ? `重新查询已选择的 ${selectedArtistIds.length} 个艺术家。`
              : refreshExisting
                ? '查询并连续刷新全部具有正式 Pixiv 身份的艺术家。'
                : '查询并连续补全全部尚未检查的 Pixiv 艺术家。'}
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
                {selectionExceedsLimit ? '选择数量超过限制' : refreshExisting ? '刷新已有资料' : '保护现有资料'}
              </AlertTitle>
              <AlertDescription>
                {selectionExceedsLimit
                  ? `一次最多选择 ${PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT} 个艺术家。`
                  : refreshExisting
                    ? selectedMode
                      ? '将重新下载并替换所选艺术家的 Pixiv 头像和背景图；下载失败或 Pixiv 无对应图片时保留现有图片。主姓名不会被覆盖。'
                      : `当前 ${summary?.eligibleCount ?? 0} 个 Pixiv 艺术家会按最久未检查顺序全部排入持久队列；Worker 每次只处理一位，关闭页面不影响执行。下载失败或 Pixiv 无对应图片时保留现有图片。`
                    : selectedMode
                      ? '所选艺术家即使检查过也会重查；已有头像、背景图和主姓名不会被覆盖。'
                      : `当前 ${summary?.candidateCount ?? 0} 个未检查艺术家会按每页 ${PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT} 个发现并全部排入持久队列；Worker 每次只处理一位，关闭页面不影响执行。来源姓名需手工采用。`}
              </AlertDescription>
            </Alert>

            <FieldGroup className="gap-3">
              <Field orientation="horizontal">
                <Checkbox
                  id="pixiv-artist-refresh-existing"
                  checked={refreshExisting}
                  disabled={active || hasBatchSession}
                  onCheckedChange={(checked) => setRefreshExisting(checked === true)}
                />
                <FieldContent>
                  <FieldLabel htmlFor="pixiv-artist-refresh-existing">刷新已有资料</FieldLabel>
                  <FieldDescription>使用 Pixiv 最新头像和背景图替换现有图片，主姓名仍需手工采用。</FieldDescription>
                </FieldContent>
              </Field>
            </FieldGroup>

            {selectedMode ? (
              <SelectedArtistSummary artists={displayedArtists} />
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
                  {activeMessage || 'Worker 正在处理艺术家'}
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
                  artistIds: selectedMode ? selectedArtistIds : undefined,
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
              {selectedMode
                ? `${refreshExisting ? '刷新' : '补全'}已选 ${selectedArtistIds.length} 项`
                : `连续${refreshExisting ? '刷新' : '补全'}全部（${availableCount} 个）`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SelectedArtistSummary({ artists }: { artists: SelectedArtist[] }) {
  const visible = artists.slice(0, 6)
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/20 p-4">
      <div className="grid grid-cols-2 gap-3">
        <SummaryMetric label="本次选择" value={artists.length} />
        <SummaryMetric label="已检查" value={artists.filter((artist) => artist.checked).length} />
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="已选择的艺术家">
        {visible.map((artist) => (
          <Badge key={artist.id} variant="outline" className="max-w-40 truncate font-normal">
            {artist.name}
          </Badge>
        ))}
        {artists.length > visible.length ? (
          <Badge variant="secondary">另有 {artists.length - visible.length} 项</Badge>
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
        <AlertTitle>本次补全已结束</AlertTitle>
        <AlertDescription>
          {failedCount ? `${failedCount} 个艺术家处理失败，可在列表中单独重试。` : '批次执行失败。'}
        </AlertDescription>
      </Alert>
    )
  }
  if (status === 'CANCELLED' || cancelledCount > 0) {
    return (
      <Alert variant="warning">
        <CircleStop aria-hidden="true" />
        <AlertTitle>本次补全已停止</AlertTitle>
        <AlertDescription>未完成的艺术家没有继续处理。</AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert variant="success">
      <CheckCircle2 aria-hidden="true" />
      <AlertTitle>本次补全已完成</AlertTitle>
      <AlertDescription>艺术家来源资料与图片状态已刷新。</AlertDescription>
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
