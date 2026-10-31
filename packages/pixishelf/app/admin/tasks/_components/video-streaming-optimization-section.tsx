'use client'

import { useCallback, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Film, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import MultipleSelector, { type Option } from '@/components/shared/multiple-selector'
import { ProTable, type ActionType, type ProColumnDef } from '@/components/shared/pro-table'
import { confirm } from '@/components/shared/global-confirm'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { MSource, OSource, type ESource } from '@/enums/e-source'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { DEFAULT_VIDEO_OPTIMIZATION_STATUSES, VIDEO_OPTIMIZATION_STATUSES } from '@/schemas/video-optimization.dto'
import type {
  PreviewVideoStreamingOptimizationBatchInput,
  VideoOptimizationBatchResult,
  VideoOptimizationCandidate,
  VideoOptimizationCandidatePage,
  VideoOptimizationFilters,
  VideoOptimizationStatus
} from '@/types/video-optimization'
import { TaskSection } from './task-ui'

const statusLabels: Record<VideoOptimizationStatus, string> = {
  NONE: '无记录',
  ACTIVE: '活动中',
  COMPLETED: '最近成功',
  FAILED: '最近失败',
  CANCELLED: '最近取消',
  SKIPPED: '最近跳过'
}

function defaultDraft() {
  return {
    artworkId: '',
    title: '',
    artistName: '',
    tags: [] as Option[],
    excludeTags: [] as Option[],
    sources: [] as Option[],
    statuses: [...DEFAULT_VIDEO_OPTIMIZATION_STATUSES] as VideoOptimizationStatus[]
  }
}

export function VideoStreamingOptimizationSection({
  onViewTasks,
  onSubmitted
}: {
  onViewTasks?: (artworkId?: number) => void
  onSubmitted?: () => void
}) {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const queryClient = useQueryClient()
  const tableRef = useRef<ActionType | undefined>(undefined)
  const [draft, setDraft] = useState(defaultDraft)
  const [filters, setFilters] = useState<VideoOptimizationFilters>({
    statuses: [...DEFAULT_VIDEO_OPTIMIZATION_STATUSES]
  })
  const [page, setPage] = useState(1)
  const currentView = useRef({ filters, page })
  currentView.current = { filters, page }
  const [candidates, setCandidates] = useState<VideoOptimizationCandidatePage>()
  const [selection, setSelection] = useState<PreviewVideoStreamingOptimizationBatchInput['selection']>({
    mode: 'SELECTED',
    artworkIds: []
  })
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<VideoOptimizationBatchResult>()
  const request = useCallback(
    async ({ current }: { current: number }) => {
      const data = await queryClient.fetchQuery(
        trpc.job.listVideoStreamingOptimizationCandidates.queryOptions(
          {
            filters,
            page: current,
            pageSize: 20
          },
          { staleTime: 0, retry: false }
        )
      )
      if (currentView.current.filters === filters && currentView.current.page === current) setCandidates(data)
      return { data: data.items, success: true, total: data.total }
    },
    [filters, queryClient, trpc]
  )
  const previewMutation = useMutation(
    trpc.job.previewVideoStreamingOptimizationBatch.mutationOptions({
      retry: false,
      onError: (error) => toast.error(`预览失败：${error.message}。选择已保留，可刷新后重试。`)
    })
  )
  const submitMutation = useMutation(
    trpc.job.submitVideoStreamingOptimizationBatch.mutationOptions({
      retry: false,
      onSuccess: (data) => {
        setResult(data)
        setSelection({ mode: 'SELECTED', artworkIds: [] })
        void queryClient.invalidateQueries({ queryKey: trpc.job.listVideoStreamingOptimizationCandidates.queryKey() })
        void queryClient.invalidateQueries({ queryKey: trpc.job.backgroundDashboard.queryKey() })
        void queryClient.invalidateQueries({ queryKey: trpc.job.backgroundHistory.queryKey() })
        tableRef.current?.reload()
        onSubmitted?.()
      },
      onError: (error) => toast.error(`提交失败：${error.message}。选择已保留，可刷新后重试。`)
    })
  )
  const busy = previewMutation.isPending || confirming || submitMutation.isPending
  const selectable = (candidates?.items ?? []).filter((item) => item.actionableMp4Count > 0)
  const isSelected = (artworkId: number) =>
    selection.mode === 'SELECTED'
      ? selection.artworkIds.includes(artworkId)
      : !selection.excludedArtworkIds?.includes(artworkId)
  const selectedOnPage = selectable.filter((item) => isSelected(item.artworkId)).length
  const selectedCount =
    selection.mode === 'SELECTED'
      ? selection.artworkIds.length
      : Math.max(0, (candidates?.total ?? 0) - (selection.excludedArtworkIds?.length ?? 0))
  const setSelected = (ids: number[], checked: boolean) =>
    setSelection((previous) => {
      if (previous.mode === 'SELECTED') {
        return {
          mode: 'SELECTED',
          artworkIds: checked
            ? [...new Set([...previous.artworkIds, ...ids])]
            : previous.artworkIds.filter((id) => !ids.includes(id))
        }
      }
      return {
        mode: 'ALL_MATCHING',
        excludedArtworkIds: checked
          ? (previous.excludedArtworkIds ?? []).filter((id) => !ids.includes(id))
          : [...new Set([...(previous.excludedArtworkIds ?? []), ...ids])]
      }
    })
  const applyFilters = (reset = false) => {
    const next = reset ? defaultDraft() : draft
    if (reset) setDraft(next)
    setFilters({
      artworkId: next.artworkId ? Number(next.artworkId) : undefined,
      title: next.title.trim() || undefined,
      artistName: next.artistName.trim() || undefined,
      tags: next.tags.map((tag) => tag.value),
      excludeTags: next.excludeTags.map((tag) => tag.value),
      sources: next.sources.map((source) => source.value as ESource),
      statuses: next.statuses
    })
    setPage(1)
    setCandidates(undefined)
    setSelection({ mode: 'SELECTED', artworkIds: [] })
    setResult(undefined)
  }
  const searchTags = async (query: string) => {
    const response = await trpcClient.tag.list.query({ query, pageSize: 20 })
    return response.items.map((tag) => ({
      value: tag.name,
      label: tag.name_zh ? `${tag.name} (${tag.name_zh})` : tag.name
    }))
  }
  const preview = async () => {
    const data = await previewMutation.mutateAsync({ filters, selection }).catch(() => undefined)
    if (!data) return
    if (data.mp4Count > 1000) {
      toast.error(`当前选择包含 ${data.mp4Count} 个 MP4，超过单批 1000 个上限。整批未提交，请缩小范围。`)
      return
    }
    if (!data.mp4Count) {
      toast.info('当前选择没有可提交的 MP4，请刷新列表后重新选择。')
      return
    }
    setConfirming(true)
    confirm({
      title: '确认执行 MP4 无损播放优化？',
      description: (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            将提交 {data.artworkCount} 部作品中的 {data.mp4Count} 个 MP4，其中 {data.successRedoCount}{' '}
            个为最近成功项重做。
          </p>
          <p>
            仅处理所选作品中符合已应用筛选的 MP4。将使用 FFmpeg stream copy + faststart 移动 moov
            并重建容器索引，视频和音频不会重新编码。
          </p>
          <p>不保证压缩体积，也不会增加关键帧。</p>
          <p>成功后会原位替换文件。执行期间请勿从外部修改或移动该视频。</p>
        </div>
      ),
      confirmText: '加入优化队列',
      onCancel: () => setConfirming(false),
      onConfirm: async () => {
        await submitMutation.mutateAsync({ targets: data.targets }).catch(() => undefined)
        setConfirming(false)
      }
    })
  }
  const columns: ProColumnDef<VideoOptimizationCandidate>[] = [
    {
      id: 'selection',
      header: () => (
        <Checkbox
          aria-label="选择本页作品"
          disabled={busy || !selectable.length}
          checked={
            selectedOnPage === selectable.length && selectable.length > 0
              ? true
              : selectedOnPage > 0
                ? 'indeterminate'
                : false
          }
          onCheckedChange={(checked) =>
            setSelected(
              selectable.map((item) => item.artworkId),
              checked === true
            )
          }
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`选择作品 #${row.original.artworkId}`}
          disabled={busy || row.original.actionableMp4Count === 0}
          checked={isSelected(row.original.artworkId) && row.original.actionableMp4Count > 0}
          onCheckedChange={(checked) => setSelected([row.original.artworkId], checked === true)}
        />
      )
    },
    {
      id: 'artwork',
      header: '作品',
      cell: ({ row }) => (
        <div className="flex min-w-40 flex-col gap-1">
          <PrivacySensitiveText className="break-words font-medium">{row.original.title}</PrivacySensitiveText>
          <span className="text-xs text-muted-foreground">内部 ID #{row.original.artworkId}</span>
        </div>
      )
    },
    {
      id: 'artists',
      header: '艺术家',
      cell: ({ row }) => (
        <PrivacySensitiveText className="break-words">
          {row.original.artists.map((artist) => artist.name).join('、') || '未关联艺术家'}
        </PrivacySensitiveText>
      )
    },
    { accessorKey: 'source', header: '创建来源', cell: ({ row }) => MSource[row.original.source] },
    {
      id: 'mp4',
      header: 'MP4',
      cell: ({ row }) => (
        <div className="flex flex-col gap-1 text-xs tabular-nums">
          <span>
            匹配 {row.original.matchingMp4Count} / 共 {row.original.mp4Count}
          </span>
          <span className="text-muted-foreground">可提交 {row.original.actionableMp4Count}</span>
        </div>
      )
    },
    {
      id: 'statuses',
      header: '任务状态',
      cell: ({ row }) => (
        <div className="flex min-w-36 flex-wrap gap-1">
          {VIDEO_OPTIMIZATION_STATUSES.filter((status) => row.original.statusCounts[status] > 0).map((status) => (
            <Badge key={status} variant="outline">
              {statusLabels[status]} {row.original.statusCounts[status]}
            </Badge>
          ))}
        </div>
      )
    },
    {
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <Button type="button" size="sm" variant="ghost" onClick={() => onViewTasks?.(row.original.artworkId)}>
          查看任务
        </Button>
      )
    }
  ]

  return (
    <TaskSection
      id="video-streaming"
      category="持久队列"
      icon={Film}
      title="MP4 无损播放优化"
      description="筛选作品并批量提交匹配的 MP4；活动中任务不会重复创建。"
      summary={null}
      action={
        <Button type="button" variant="outline" onClick={() => onViewTasks?.()}>
          查看优化任务
        </Button>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy && draft.statuses.length) applyFilters()
        }}
      >
        <FieldGroup className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="video-optimization-artwork-id">内部作品 ID</FieldLabel>
            <Input
              id="video-optimization-artwork-id"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={draft.artworkId}
              disabled={busy}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, artworkId: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="video-optimization-title">作品标题</FieldLabel>
            <Input
              id="video-optimization-title"
              value={draft.title}
              maxLength={500}
              placeholder="仅匹配作品标题"
              disabled={busy}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="video-optimization-artist">艺术家名</FieldLabel>
            <Input
              id="video-optimization-artist"
              value={draft.artistName}
              maxLength={500}
              disabled={busy}
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, artistName: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="video-optimization-tags">包含标签</FieldLabel>
            <MultipleSelector
              value={draft.tags}
              inputProps={{ id: 'video-optimization-tags' }}
              disabled={busy}
              maxSelected={100}
              onChange={(tags) => setDraft((previous) => ({ ...previous, tags }))}
              onSearch={searchTags}
              triggerSearchOnFocus
              placeholder="搜索并选择包含标签…"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="video-optimization-exclude-tags">排除标签</FieldLabel>
            <MultipleSelector
              value={draft.excludeTags}
              inputProps={{ id: 'video-optimization-exclude-tags' }}
              disabled={busy}
              maxSelected={100}
              onChange={(excludeTags) => setDraft((previous) => ({ ...previous, excludeTags }))}
              onSearch={searchTags}
              triggerSearchOnFocus
              placeholder="搜索并选择排除标签…"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="video-optimization-sources">创建来源</FieldLabel>
            <MultipleSelector
              value={draft.sources}
              inputProps={{ id: 'video-optimization-sources' }}
              disabled={busy}
              options={OSource}
              onChange={(sources) => setDraft((previous) => ({ ...previous, sources }))}
              placeholder="选择创建来源…"
            />
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant="outline" disabled={busy}>
                任务状态 · {draft.statuses.length}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start">
              <FieldSet>
                <FieldLegend>匹配 MP4 的最近任务状态</FieldLegend>
                <FieldGroup className="gap-3">
                  {VIDEO_OPTIMIZATION_STATUSES.map((status) => (
                    <Field key={status} orientation="horizontal">
                      <Checkbox
                        id={`video-optimization-status-${status.toLowerCase()}`}
                        checked={draft.statuses.includes(status)}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          setDraft({
                            ...draft,
                            statuses: checked
                              ? [...draft.statuses, status]
                              : draft.statuses.filter((value) => value !== status)
                          })
                        }
                      />
                      <FieldLabel htmlFor={`video-optimization-status-${status.toLowerCase()}`}>
                        {statusLabels[status]}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
              </FieldSet>
            </PopoverContent>
          </Popover>
          <Button type="submit" size="sm" disabled={busy || !draft.statuses.length}>
            <Search data-icon="inline-start" aria-hidden="true" />
            应用筛选
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => applyFilters(true)}>
            重置
          </Button>
          {!draft.statuses.length ? (
            <p role="alert" className="text-sm text-destructive">
              请至少选择一种任务状态。
            </p>
          ) : null}
        </div>
      </form>
      <p className="text-xs text-muted-foreground">
        任务状态按每个 MP4 的最近任务统计。活动中包括排队、执行、暂停、自动重试及取消中；成功项需显式筛选后重做。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm tabular-nums" role="status">
          {selection.mode === 'ALL_MATCHING'
            ? `已选择所有筛选结果${selection.excludedArtworkIds?.length ? `，排除 ${selection.excludedArtworkIds.length} 部作品` : ''}`
            : `已选择 ${selectedCount} 部作品`}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !candidates?.total}
          onClick={() => setSelection({ mode: 'ALL_MATCHING', excludedArtworkIds: [] })}
        >
          全选所有筛选结果
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || !selectedCount}
          onClick={() => setSelection({ mode: 'SELECTED', artworkIds: [] })}
        >
          清空选择
        </Button>
        <Button type="button" size="sm" disabled={busy || !selectedCount} onClick={() => void preview()}>
          {busy ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}预览并提交
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => tableRef.current?.reload()}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          刷新作品
        </Button>
      </div>
      {result ? (
        <Alert variant={result.failed || result.skipped ? 'warning' : 'success'}>
          <AlertTitle>批量提交结果</AlertTitle>
          <AlertDescription>
            <p>
              新建 {result.submitted} · 复用 {result.reused} · 跳过 {result.skipped} · 失败 {result.failed}
            </p>
            {result.items.some((item) => item.outcome === 'FAILED' || item.outcome === 'SKIPPED') ? (
              <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {result.items
                  .filter((item) => item.outcome === 'FAILED' || item.outcome === 'SKIPPED')
                  .map((item) => (
                    <li key={item.imageId}>
                      作品 #{item.artworkId} · 视频 #{item.imageId} · {item.outcome === 'SKIPPED' ? '跳过' : '失败'}：
                      {item.reason || '请刷新作品后重新选择。'}
                    </li>
                  ))}
              </ul>
            ) : null}
            <Button type="button" size="sm" variant="outline" onClick={() => onViewTasks?.()}>
              查看优化任务
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <ProTable
        key={`${JSON.stringify(filters)}:${page}`}
        columns={columns}
        request={request}
        actionRef={tableRef}
        rowKey={(item) => String(item.artworkId)}
        defaultPageSize={20}
        pageSizeOptions={[20]}
        pagination={{ pageIndex: page - 1, pageSize: 20 }}
        onPaginationChange={(updater) => {
          if (busy) return
          const next = typeof updater === 'function' ? updater({ pageIndex: page - 1, pageSize: 20 }) : updater
          setCandidates(undefined)
          setPage(next.pageIndex + 1)
        }}
        toolBarRender={false}
        scrollToTopOnPageChange={false}
      />
    </TaskSection>
  )
}
