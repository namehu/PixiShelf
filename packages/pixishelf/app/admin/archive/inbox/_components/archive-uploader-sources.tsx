'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { inferRouterOutputs } from '@trpc/server'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  CircleStopIcon,
  HistoryIcon,
  PlusIcon,
  RefreshCwIcon,
  UserSearchIcon
} from 'lucide-react'
import { toast } from 'sonner'
import type { AppRouter } from '@/server'
import { useTRPC } from '@/lib/trpc'
import { AdminSection, AdminSectionHeader } from '@/app/admin/_components/admin-workbench'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { archiveUploaderDetailPollingInterval, isActiveArchiveUploaderRunStatus } from './archive-uploader-view-state'

type RouterOutputs = inferRouterOutputs<AppRouter>
type UploaderSource = RouterOutputs['archiveUploader']['listSources'][number]
type ScanItem = RouterOutputs['archiveUploader']['listItems']['items'][number]
type ScanRun = RouterOutputs['archiveUploader']['getSource']['runs'][number]

const ACTIONABLE_CLASSIFICATIONS = new Set(['NEW', 'POSSIBLE_UPDATE', 'REPLACEMENT'])
const SCAN_RESULT_PAGE_SIZE = 50
const MAX_SELECTED_ITEMS = 100

export function ArchiveUploaderSources() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [cancelRequestedRunId, setCancelRequestedRunId] = useState<string | null>(null)
  const refreshedCompletedRunId = useRef<string | null>(null)

  const sourcesQuery = useQuery(
    trpc.archiveUploader.listSources.queryOptions(
      { includeArchived: true },
      {
        refetchInterval: (query) =>
          query.state.data?.some((source) => isActiveArchiveUploaderRunStatus(source.latestRun?.status)) ? 3_000 : false
      }
    )
  )
  const sources = useMemo(() => sourcesQuery.data ?? [], [sourcesQuery.data])

  useEffect(() => {
    if (!selectedSourceId && sources[0]) setSelectedSourceId(sources[0].id)
    if (selectedSourceId && !sources.some(({ id }) => id === selectedSourceId)) {
      setSelectedSourceId(sources[0]?.id ?? null)
    }
  }, [selectedSourceId, sources])

  const detailQuery = useQuery(
    trpc.archiveUploader.getSource.queryOptions(
      { sourceId: selectedSourceId ?? 'unselected' },
      {
        enabled: Boolean(selectedSourceId),
        refetchInterval: (query) => archiveUploaderDetailPollingInterval(query.state.data)
      }
    )
  )
  const detail = detailQuery.data
  const activeRun = detail?.runs.find((run) => isActiveArchiveUploaderRunStatus(run.status))
  const latestRun = detail?.runs[0]
  const itemsQuery = useInfiniteQuery(
    trpc.archiveUploader.listItems.infiniteQueryOptions(
      { sourceId: selectedSourceId ?? 'unselected', limit: SCAN_RESULT_PAGE_SIZE },
      {
        initialCursor: null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: Boolean(selectedSourceId)
      }
    )
  )
  const items = useMemo(() => itemsQuery.data?.pages.flatMap((page) => page.items) ?? [], [itemsQuery.data])

  useEffect(() => {
    if (latestRun?.status !== 'COMPLETED') return
    if (refreshedCompletedRunId.current === latestRun.id) return
    refreshedCompletedRunId.current = latestRun.id
    void queryClient.invalidateQueries({ queryKey: trpc.archiveUploader.listItems.queryKey() })
  }, [latestRun?.id, latestRun?.status, queryClient, trpc.archiveUploader.listItems])

  useEffect(() => {
    if (!cancelRequestedRunId) return
    if (!activeRun || activeRun.id !== cancelRequestedRunId) setCancelRequestedRunId(null)
  }, [activeRun, cancelRequestedRunId])

  useEffect(() => {
    setSelectedItemIds((current) => {
      const available = new Set(items.filter(isActionableItem).map(({ id }) => id))
      return new Set([...current].filter((id) => available.has(id)))
    })
  }, [items])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.archiveUploader.listSources.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveUploader.getSource.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveUploader.listItems.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.summary.queryKey() })
    ])
  }
  const scanMutation = useMutation(
    trpc.archiveUploader.triggerScan.mutationOptions({
      onSuccess: async (run) => {
        setSelectedItemIds(new Set())
        toast.success(run.mode === 'LATEST' ? '最新扫描已加入队列' : '旧页扫描已加入队列')
        await refresh()
      },
      onError: (error) =>
        toast.error('扫描启动失败', { description: archiveClientErrorMessage(error, '暂时无法启动上传者扫描。') })
    })
  )
  const cancelMutation = useMutation(
    trpc.archiveUploader.cancelScan.mutationOptions({
      onSuccess: async (result) => {
        setCancelRequestedRunId(result.id)
        toast.success(result.status === 'CANCELLED' ? '扫描已取消' : '已请求取消扫描')
        await refresh()
      },
      onError: (error) =>
        toast.error('取消扫描失败', { description: archiveClientErrorMessage(error, '请刷新后重试。') })
    })
  )
  const archiveMutation = useMutation(
    trpc.archiveUploader.setArchived.mutationOptions({
      onSuccess: async (result) => {
        toast.success(result.status === 'ARCHIVED' ? '上传者来源已归档' : '上传者来源已重新启用')
        await refresh()
      },
      onError: (error) =>
        toast.error('来源状态更新失败', { description: archiveClientErrorMessage(error, '请刷新后重试。') })
    })
  )
  const addMutation = useMutation(
    trpc.archiveUploader.addToInbox.mutationOptions({
      onSuccess: async (submission) => {
        setSelectedItemIds(new Set())
        const description = `接收 ${submission.acceptedCount} · 重复 ${submission.duplicateCount} · 拒绝 ${submission.rejectedCount}`
        if (submission.rejectedCount > 0) {
          toast.warning(submission.acceptedCount > 0 ? '部分结果未进入收件箱' : '收件箱容量不足', {
            description: `${description}；释放容量后可重新勾选提交。`
          })
        } else {
          toast.success('扫描结果已加入收件箱', { description })
        }
        await refresh()
      },
      onError: (error) =>
        toast.error('加入收件箱失败', { description: archiveClientErrorMessage(error, '所选结果暂时无法加入收件箱。') })
    })
  )

  const source = detail?.source
  const loadMoreItems = useCallback(() => void itemsQuery.fetchNextPage(), [itemsQuery.fetchNextPage])
  const retryItems = useCallback(() => void itemsQuery.refetch(), [itemsQuery.refetch])
  const actionableItems = items.filter(isActionableItem)
  const bulkSelectableItems = actionableItems.slice(0, MAX_SELECTED_ITEMS)
  const allActionableSelected =
    bulkSelectableItems.length > 0 && bulkSelectableItems.every((item) => selectedItemIds.has(item.id))
  const mutationPending =
    scanMutation.isPending || cancelMutation.isPending || archiveMutation.isPending || addMutation.isPending

  return (
    <div className="flex flex-col gap-6 pt-4">
      <AdminSectionHeader
        title="E-Hentai 上传者来源"
        description="按名称或 UID 保存来源；每次扫描都由你手动发起，结果确认后才进入归档收件箱。"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            新增来源
          </Button>
        }
      />

      {sourcesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>来源加载失败</AlertTitle>
          <AlertDescription>上传者来源仍保存在数据库中，请稍后重新加载。</AlertDescription>
        </Alert>
      ) : sourcesQuery.isPending ? (
        <UploaderSourcesLoading />
      ) : sources.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserSearchIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>还没有上传者来源</EmptyTitle>
            <EmptyDescription>先保存一个上传者名称或数字 UID，再手动扫描其公开画廊。</EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            新增来源
          </Button>
        </Empty>
      ) : (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <SourceList
            sources={sources}
            selectedSourceId={selectedSourceId}
            onSelect={(sourceId) => {
              setSelectedSourceId(sourceId)
              setSelectedItemIds(new Set())
              setCancelRequestedRunId(null)
            }}
          />
          <AdminSection>
            {detailQuery.isPending ? (
              <UploaderDetailLoading />
            ) : !source ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>请选择上传者来源</EmptyTitle>
                  <EmptyDescription>从左侧来源列表选择一项查看扫描记录。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {source.displayName}
                      <Badge variant={source.status === 'ACTIVE' ? 'success' : 'muted'}>
                        {source.status === 'ACTIVE' ? '已启用' : '已归档'}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      {source.identityKind === 'UID'
                        ? `上传者 UID ${source.identityValue}`
                        : `上传者名称 ${source.identityValue}`}
                      {source.lastSuccessAt
                        ? ` · 上次成功 ${formatTimestamp(source.lastSuccessAt)}`
                        : ' · 尚未完成扫描'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {activeRun ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <Spinner aria-hidden="true" />
                        <span>
                          {activeRun.mode === 'LATEST' ? '最新扫描' : '更早内容扫描'} ·{' '}
                          {formatTimestamp(activeRun.createdAt)}
                        </span>
                        <Badge variant="warning">{scanRunStatusLabel(activeRun.status)}</Badge>
                      </div>
                    ) : latestRun ? (
                      <p className="text-sm text-muted-foreground">
                        最近运行 · {latestRun.mode === 'LATEST' ? '最新扫描' : '更早内容'} ·{' '}
                        {formatTimestamp(latestRun.createdAt)} · {scanRunStatusLabel(latestRun.status)} ·{' '}
                        {latestRun.itemCount} 条
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {source.status === 'ACTIVE' ? (
                        <>
                          <Button
                            onClick={() => scanMutation.mutate({ sourceId: source.id, mode: 'LATEST' })}
                            disabled={Boolean(activeRun) || mutationPending}
                          >
                            {scanMutation.isPending ? (
                              <Spinner data-icon="inline-start" />
                            ) : (
                              <RefreshCwIcon data-icon="inline-start" />
                            )}
                            {source.hasPendingLatest ? '继续最新扫描' : '扫描最新'}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => scanMutation.mutate({ sourceId: source.id, mode: 'HISTORY' })}
                            disabled={!source.canContinueHistory || Boolean(activeRun) || mutationPending}
                          >
                            <HistoryIcon data-icon="inline-start" aria-hidden="true" />
                            继续扫描更早内容
                          </Button>
                          {activeRun ? (
                            <Button
                              variant="outline"
                              onClick={() => cancelMutation.mutate({ sourceId: source.id, runId: activeRun.id })}
                              disabled={cancelMutation.isPending || cancelRequestedRunId === activeRun.id}
                            >
                              {cancelMutation.isPending || cancelRequestedRunId === activeRun.id ? (
                                <Spinner data-icon="inline-start" />
                              ) : (
                                <CircleStopIcon data-icon="inline-start" aria-hidden="true" />
                              )}
                              {cancelRequestedRunId === activeRun.id ? '正在取消' : '取消扫描'}
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            onClick={() => archiveMutation.mutate({ sourceId: source.id, archived: true })}
                            disabled={Boolean(activeRun) || mutationPending}
                          >
                            <ArchiveIcon data-icon="inline-start" aria-hidden="true" />
                            归档来源
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => archiveMutation.mutate({ sourceId: source.id, archived: false })}
                          disabled={mutationPending}
                        >
                          <ArchiveRestoreIcon data-icon="inline-start" aria-hidden="true" />
                          重新启用
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {source.lastErrorMessage ? (
                  <Alert variant="destructive">
                    <AlertTitle>上次扫描未完成</AlertTitle>
                    <AlertDescription>{source.lastErrorMessage}</AlertDescription>
                  </Alert>
                ) : null}

                <AdminSectionHeader
                  title="发现结果"
                  description={`按画廊汇总最近 30 天的完成扫描并去重；已加载 ${items.length} 条，向下滚动自动加载更多。`}
                  actions={
                    <Button
                      onClick={() =>
                        source &&
                        addMutation.mutate({
                          sourceId: source.id,
                          submissionAttemptId: globalThis.crypto.randomUUID(),
                          itemIds: [...selectedItemIds]
                        })
                      }
                      disabled={selectedItemIds.size === 0 || mutationPending}
                    >
                      {addMutation.isPending ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <CheckIcon data-icon="inline-start" />
                      )}
                      加入收件箱（{selectedItemIds.size}）
                    </Button>
                  }
                />
                <ScanResults
                  runs={detail.runs}
                  activeRun={activeRun}
                  items={items}
                  isLoading={itemsQuery.isLoading}
                  isError={itemsQuery.isError}
                  hasNextPage={itemsQuery.hasNextPage}
                  isFetchingNextPage={itemsQuery.isFetchingNextPage}
                  onLoadMore={loadMoreItems}
                  onRetry={retryItems}
                  selectedItemIds={selectedItemIds}
                  allActionableSelected={allActionableSelected}
                  onToggleAll={(checked) =>
                    setSelectedItemIds(checked ? new Set(bulkSelectableItems.map(({ id }) => id)) : new Set())
                  }
                  onToggle={(itemId, checked) =>
                    setSelectedItemIds((current) => {
                      const next = new Set(current)
                      if (checked && next.size < MAX_SELECTED_ITEMS) next.add(itemId)
                      else next.delete(itemId)
                      return next
                    })
                  }
                />
              </>
            )}
          </AdminSection>
        </div>
      )}

      <CreateSourceDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={refresh} />
    </div>
  )
}

function SourceList({
  sources,
  selectedSourceId,
  onSelect
}: {
  sources: UploaderSource[]
  selectedSourceId: string | null
  onSelect: (sourceId: string) => void
}) {
  return (
    <Card className="h-fit gap-2 py-3">
      <CardHeader className="px-3">
        <CardTitle className="text-sm">已保存来源</CardTitle>
        <CardDescription>{sources.length} 个来源，包含已归档项</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 px-2">
        {sources.map((source) => (
          <Button
            key={source.id}
            variant={selectedSourceId === source.id ? 'secondary' : 'ghost'}
            className="h-auto min-h-11 justify-start px-3 py-2 text-left"
            onClick={() => onSelect(source.id)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{source.displayName}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {source.latestRun
                  ? `${scanRunStatusLabel(source.latestRun.status)} · ${source.latestRun.itemCount} 条`
                  : '尚未扫描'}
              </span>
            </span>
            {source.status === 'ARCHIVED' ? <Badge variant="muted">归档</Badge> : null}
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}

function ScanResults({
  runs,
  activeRun,
  items,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onRetry,
  selectedItemIds,
  allActionableSelected,
  onToggleAll,
  onToggle
}: {
  runs: ScanRun[]
  activeRun?: ScanRun
  items: ScanItem[]
  isLoading: boolean
  isError: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  onRetry: () => void
  selectedItemIds: Set<string>
  allActionableSelected: boolean
  onToggleAll: (checked: boolean) => void
  onToggle: (itemId: string, checked: boolean) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    useFlushSync: false,
    count: hasNextPage ? items.length + 1 : items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 104,
    overscan: 6
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const lastVirtualIndex = virtualRows.at(-1)?.index

  useEffect(() => {
    if (lastVirtualIndex == null || lastVirtualIndex < items.length - 6 || !hasNextPage || isFetchingNextPage) {
      return
    }
    onLoadMore()
  }, [hasNextPage, isFetchingNextPage, items.length, lastVirtualIndex, onLoadMore])

  if (isLoading) return <Skeleton className="h-[60vh] min-h-80 w-full" />
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>扫描结果加载失败</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>扫描记录仍保存在数据库中，请稍后重试。</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
            重新加载
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (runs.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>尚无扫描记录</EmptyTitle>
          <EmptyDescription>点击“扫描最新”创建第一批发现结果。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  if (items.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{activeRun ? '正在扫描' : '没有发现结果'}</EmptyTitle>
          <EmptyDescription>
            {activeRun
              ? '任务完成后，结果会自动汇入这里，不需要切换扫描批次。'
              : '已完成的扫描暂未找到需要展示的公开画廊。'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid min-h-12 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 border-b bg-muted/30 px-4 text-xs font-medium text-muted-foreground sm:grid-cols-[2.5rem_minmax(0,1fr)_9rem_8rem]">
        <Checkbox
          checked={allActionableSelected ? true : selectedItemIds.size > 0 ? 'indeterminate' : false}
          onCheckedChange={(checked) => onToggleAll(checked === true)}
          aria-label="选择当前已加载的可加入结果，最多一百条"
        />
        <span>画廊</span>
        <span className="hidden sm:block">发布时间</span>
        <span className="hidden sm:block">判断</span>
      </div>
      <ScrollArea className="h-[60vh] min-h-80 max-h-[44rem]" viewportRef={scrollRef}>
        <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {virtualRows.map((virtualRow) => {
            const item = items[virtualRow.index]
            return (
              <div
                key={virtualRow.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                className="absolute left-0 top-0 w-full border-b bg-background px-4 py-3"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {item ? (
                  <div
                    className="grid min-h-16 grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_9rem_8rem] sm:items-center"
                    data-state={selectedItemIds.has(item.id) ? 'selected' : undefined}
                  >
                    <Checkbox
                      checked={selectedItemIds.has(item.id)}
                      disabled={
                        !isActionableItem(item) ||
                        (!selectedItemIds.has(item.id) && selectedItemIds.size >= MAX_SELECTED_ITEMS)
                      }
                      onCheckedChange={(checked) => onToggle(item.id, checked === true)}
                      aria-label={`选择 ${item.title}`}
                    />
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 font-medium">{item.title}</p>
                        <span className="shrink-0 sm:hidden">
                          <ClassificationBadge classification={item.classification} />
                        </span>
                      </div>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        E-Hentai #{item.externalId} · {item.displayUrl}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                        {item.postedAt ? formatTimestamp(item.postedAt) : '发布时间未知'}
                      </p>
                      {item.intakeItemId ? <p className="mt-1 text-xs text-muted-foreground">已加入收件箱</p> : null}
                    </div>
                    <p className="hidden whitespace-nowrap text-sm text-muted-foreground sm:block">
                      {item.postedAt ? formatTimestamp(item.postedAt) : '—'}
                    </p>
                    <span className="hidden sm:block">
                      <ClassificationBadge classification={item.classification} />
                    </span>
                  </div>
                ) : (
                  <div className="flex min-h-16 items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Spinner aria-hidden="true" />
                    正在加载更多结果…
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
      <div className="flex min-h-11 items-center justify-between gap-3 border-t px-4 text-xs text-muted-foreground">
        <span>
          已加载 {items.length} 条 · 单次最多选择 {MAX_SELECTED_ITEMS} 条
        </span>
        {isFetchingNextPage ? (
          <span className="flex items-center gap-2">
            <Spinner aria-hidden="true" />
            加载中
          </span>
        ) : hasNextPage ? (
          <span>继续向下滚动</span>
        ) : (
          <span>已加载全部</span>
        )}
      </div>
    </Card>
  )
}

function CreateSourceDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<void>
}) {
  const trpc = useTRPC()
  const [identityKind, setIdentityKind] = useState<'NAME' | 'UID'>('UID')
  const [identityValue, setIdentityValue] = useState('')
  const createMutation = useMutation(
    trpc.archiveUploader.createSource.mutationOptions({
      onSuccess: async () => {
        toast.success('上传者来源已保存')
        setIdentityValue('')
        onOpenChange(false)
        await onCreated()
      },
      onError: (error) =>
        toast.error('保存来源失败', { description: archiveClientErrorMessage(error, '请检查上传者身份后重试。') })
    })
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            createMutation.mutate({ identityKind, identityValue })
          }}
        >
          <DialogHeader>
            <DialogTitle>新增上传者来源</DialogTitle>
            <DialogDescription>推荐使用数字 UID；名称适合暂时无法取得 UID 的情况。</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <Field>
              <FieldLabel htmlFor="uploader-identity-kind">身份类型</FieldLabel>
              <Select value={identityKind} onValueChange={(value) => setIdentityKind(value as 'NAME' | 'UID')}>
                <SelectTrigger id="uploader-identity-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="UID">数字 UID（推荐）</SelectItem>
                    <SelectItem value="NAME">上传者名称</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="uploader-identity-value">
                {identityKind === 'UID' ? '上传者 UID' : '上传者名称'}
              </FieldLabel>
              <Input
                id="uploader-identity-value"
                value={identityValue}
                onChange={(event) => setIdentityValue(event.target.value)}
                placeholder={identityKind === 'UID' ? '例如 1234567' : '输入精确上传者名称'}
                inputMode={identityKind === 'UID' ? 'numeric' : 'text'}
                autoComplete="off"
                required
              />
              <FieldDescription>来源只会在你点击扫描按钮后访问 E-Hentai，不会定时自动扫描。</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!identityValue.trim() || createMutation.isPending}>
              {createMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
              保存来源
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ClassificationBadge({ classification }: { classification: ScanItem['classification'] }) {
  const labels = {
    NEW: '新归档',
    ACTIVE: '已有活动任务',
    ARCHIVED: '已归档且未变化',
    POSSIBLE_UPDATE: '可能更新',
    REPLACEMENT: '替代版本'
  }
  const variant =
    classification === 'NEW'
      ? 'success'
      : classification === 'POSSIBLE_UPDATE'
        ? 'info'
        : classification === 'REPLACEMENT' || classification === 'ACTIVE'
          ? 'warning'
          : 'muted'
  return <Badge variant={variant}>{labels[classification]}</Badge>
}

function isActionableItem(item: ScanItem) {
  return !item.intakeItemId && ACTIONABLE_CLASSIFICATIONS.has(item.classification)
}

function scanRunStatusLabel(status: ScanRun['status']) {
  return {
    PENDING: '等待中',
    RUNNING: '扫描中',
    RETRY_WAIT: '等待重试',
    PAUSED: '已暂停',
    COMPLETED: '已完成',
    FAILED: '失败',
    CANCELLED: '已取消'
  }[status]
}

function formatTimestamp(value: Date | string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function UploaderSourcesLoading() {
  return (
    <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

function UploaderDetailLoading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  )
}
