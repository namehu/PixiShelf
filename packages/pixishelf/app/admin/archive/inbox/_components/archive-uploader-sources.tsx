'use client'

import { ARCHIVE_TITLE_MATCH_LABELS } from '@pixishelf/job-contracts'
import { ArchiveSearchSourceDialog, type ArchiveSearchDialogState } from './archive-search-source-dialog'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { inferRouterOutputs } from '@trpc/server'
import Link from 'next/link'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowUpRightIcon,
  BanIcon,
  CheckIcon,
  CircleStopIcon,
  CopyIcon,
  FingerprintIcon,
  HistoryIcon,
  InfoIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type ArchiveUploaderResultView, useAdminPreferencesStore } from '@/store/admin/use-admin-preferences-store'
import {
  ArchiveUploaderGalleryPreviewDialog,
  ArchiveUploaderGalleryThumbnail,
  type ArchiveUploaderPreviewItem,
  ArchiveUploaderResultViewToggle
} from './archive-uploader-result-visuals'
import { ArchiveUploaderCreateSourceDialog } from './archive-uploader-create-source-dialog'
import { copyArchiveUploaderUid } from './archive-uploader-clipboard'
import { ArchiveUploaderUidConflictAlert } from './archive-uploader-uid-conflict-alert'
import { IgnoredResults } from './archive-discovery-ignored-results'
import { ArchiveUploaderSourceList } from './archive-uploader-source-list'
import { ArchiveUploaderUidDialog } from './archive-uploader-uid-dialog'
import {
  archiveUploaderDetailPollingInterval,
  archiveUploaderCatalogViewCount,
  formatArchiveUploaderTimestamp,
  historyCoverageLabel,
  isActiveArchiveUploaderRunStatus,
  latestCoverageLabel,
  scanIdentityLabel,
  scanRunStatusLabel,
  scanStopReasonLabel
} from './archive-uploader-view-state'

type RouterOutputs = inferRouterOutputs<AppRouter>
type ScanItem = RouterOutputs['archiveSearch']['listItems']['items'][number]
type ScanItemsPage = RouterOutputs['archiveSearch']['listItems']
type IgnoredItemsPage = RouterOutputs['archiveSearch']['listIgnoredItems']
type ScanRun = RouterOutputs['archiveSearch']['getSource']['runs'][number]
type CatalogView = 'ACTIONABLE' | 'PROCESSING' | 'ARCHIVED' | 'ATTENTION' | 'ALL'
type ResultFeed = CatalogView | 'IGNORED'
const SCAN_RESULT_PAGE_SIZE = 50
const MAX_SELECTED_ITEMS = 100
const RESULT_FEEDS: Array<{ value: ResultFeed; label: string }> = [
  { value: 'ACTIONABLE', label: '待处理' },
  { value: 'PROCESSING', label: '处理中' },
  { value: 'ARCHIVED', label: '已归档' },
  { value: 'ATTENTION', label: '异常' },
  { value: 'ALL', label: '全部' },
  { value: 'IGNORED', label: '全局已忽略' }
]

export function ArchiveUploaderSources() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [searchDialog, setSearchDialog] = useState<ArchiveSearchDialogState | null>(null)
  const [sourceFilter, setSourceFilter] = useState('ALL')
  const [uidDialogOpen, setUidDialogOpen] = useState(false)
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [selectedIgnoredItemIds, setSelectedIgnoredItemIds] = useState<Set<string>>(new Set())
  const [resultFeed, setResultFeed] = useState<ResultFeed>('ACTIONABLE')
  const [previewItem, setPreviewItem] = useState<ArchiveUploaderPreviewItem | null>(null)
  const [cancelRequestedRunId, setCancelRequestedRunId] = useState<string | null>(null)
  const refreshedCompletedRunId = useRef<string | null>(null)
  const previousProcessingCount = useRef<{ sourceId: string; count: number } | null>(null)
  const resultView = useAdminPreferencesStore((state) => state.archiveUploaderResultView)
  const setResultView = useAdminPreferencesStore((state) => state.setArchiveUploaderResultView)

  useEffect(() => {
    void useAdminPreferencesStore.persist.rehydrate()
  }, [])

  const sourcesQuery = useQuery(
    trpc.archiveSearch.listSources.queryOptions(
      { includeArchived: true },
      {
        refetchInterval: (query) =>
          query.state.data?.some(
            (source) =>
              isActiveArchiveUploaderRunStatus(source.latestRun?.status) || source.catalogCounts.processing > 0
          )
            ? 3_000
            : false
      }
    )
  )
  const sources = useMemo(
    () =>
      (sourcesQuery.data ?? []).filter(
        (source) => sourceFilter === 'ALL' || (source.sourceKind ?? 'UPLOADER') === sourceFilter
      ),
    [sourcesQuery.data, sourceFilter]
  )

  useEffect(() => {
    if (!selectedSourceId && sources[0]) setSelectedSourceId(sources[0].id)
    if (selectedSourceId && !sources.some(({ id }) => id === selectedSourceId)) {
      setSelectedSourceId(sources[0]?.id ?? null)
    }
  }, [selectedSourceId, sources])

  const detailQuery = useQuery(
    trpc.archiveSearch.getSource.queryOptions(
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
  const catalogPolling = Boolean(activeRun) || (detail?.source.catalogCounts.processing ?? 0) > 0
  const itemsQuery = useInfiniteQuery(
    trpc.archiveSearch.listItems.infiniteQueryOptions(
      {
        sourceId: selectedSourceId ?? 'unselected',
        view: resultFeed === 'IGNORED' ? 'ACTIONABLE' : resultFeed,
        limit: SCAN_RESULT_PAGE_SIZE
      },
      {
        initialCursor: null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: Boolean(selectedSourceId) && resultFeed !== 'IGNORED',
        refetchInterval: catalogPolling ? 3_000 : false
      }
    )
  )
  const items = useMemo(() => itemsQuery.data?.pages.flatMap((page) => page.items) ?? [], [itemsQuery.data])
  const ignoredItemsQuery = useInfiniteQuery(
    trpc.archiveSearch.listIgnoredItems.infiniteQueryOptions(
      { limit: SCAN_RESULT_PAGE_SIZE },
      {
        initialCursor: null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: resultFeed === 'IGNORED'
      }
    )
  )
  const ignoredItems = useMemo(
    () => ignoredItemsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [ignoredItemsQuery.data]
  )

  useEffect(() => {
    if (latestRun?.status !== 'COMPLETED') return
    if (refreshedCompletedRunId.current === latestRun.id) return
    refreshedCompletedRunId.current = latestRun.id
    void queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listItems.infiniteQueryKey() })
  }, [latestRun?.id, latestRun?.status, queryClient, trpc.archiveSearch.listItems])

  useEffect(() => {
    if (!selectedSourceId || !detail) return
    const count = detail.source.catalogCounts.processing
    const previous = previousProcessingCount.current
    previousProcessingCount.current = { sourceId: selectedSourceId, count }
    if (previous?.sourceId !== selectedSourceId || previous.count === 0 || count !== 0) return
    // The detail count can observe a terminal workflow event before this feed's
    // request does. Force one final catalog refresh before high-frequency polling stops.
    void queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listItems.infiniteQueryKey() })
  }, [detail, queryClient, selectedSourceId, trpc.archiveSearch.listItems])

  useEffect(() => {
    if (!cancelRequestedRunId) return
    if (!activeRun || activeRun.id !== cancelRequestedRunId) setCancelRequestedRunId(null)
  }, [activeRun, cancelRequestedRunId])

  useEffect(() => {
    setSelectedItemIds((current) => {
      const available = new Set(items.filter(isSubmittableItem).map(({ id }) => id))
      return new Set([...current].filter((id) => available.has(id)))
    })
  }, [items])

  useEffect(() => {
    setSelectedIgnoredItemIds((current) => {
      const available = new Set(ignoredItems.map(({ id }) => id))
      return new Set([...current].filter((id) => available.has(id)))
    })
  }, [ignoredItems])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listSources.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.getSource.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listItems.infiniteQueryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listIgnoredItems.infiniteQueryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.summary.queryKey() })
    ])
  }
  const scanMutation = useMutation(
    trpc.archiveSearch.triggerScan.mutationOptions({
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
    trpc.archiveSearch.cancelScan.mutationOptions({
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
    trpc.archiveSearch.setArchived.mutationOptions({
      onSuccess: async (result) => {
        toast.success(result.status === 'ARCHIVED' ? '发现来源已停用' : '发现来源已重新启用')
        await refresh()
      },
      onError: (error) =>
        toast.error('来源状态更新失败', { description: archiveClientErrorMessage(error, '请刷新后重试。') })
    })
  )
  const addMutation = useMutation(
    trpc.archiveSearch.addToInbox.mutationOptions({
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
  const submissionAttemptMutation = useMutation(
    trpc.archiveSearch.createSubmissionAttempt.mutationOptions({
      onSuccess: (attempt, variables) => {
        addMutation.mutate({ ...variables, submissionAttemptId: attempt.submissionAttemptId })
      },
      onError: (error) =>
        toast.error('无法创建提交尝试', {
          description: archiveClientErrorMessage(error, '请刷新页面后重试。')
        })
    })
  )
  const restoreMutation = useMutation(
    trpc.archiveSearch.restoreIgnoredItems.mutationOptions({
      onSuccess: async (result, variables) => {
        queryClient.setQueriesData<InfiniteData<IgnoredItemsPage>>(
          { queryKey: trpc.archiveSearch.listIgnoredItems.infiniteQueryKey() },
          (current) => removeInfiniteItems(current, variables.ignoredItemIds)
        )
        setSelectedIgnoredItemIds(new Set())
        toast.success(`已恢复 ${result.restoredCount} 个画廊`)
        await refresh()
      },
      onError: (error) =>
        toast.error('恢复失败', { description: archiveClientErrorMessage(error, '所选画廊暂时无法恢复。') })
    })
  )
  const ignoreMutation = useMutation(
    trpc.archiveSearch.ignoreItems.mutationOptions({
      onSuccess: async (result, variables) => {
        queryClient.setQueriesData<InfiniteData<ScanItemsPage>>(
          { queryKey: trpc.archiveSearch.listItems.infiniteQueryKey() },
          (current) => removeInfiniteItems(current, variables.itemIds)
        )
        setSelectedItemIds(new Set())
        toast.success(`已忽略 ${result.ignoredCount} 个画廊`, {
          description: '后续扫描仍会保持忽略，直到你手动恢复。',
          action:
            result.ignoredItemIds.length > 0
              ? {
                  label: '撤销',
                  onClick: () => restoreMutation.mutate({ ignoredItemIds: result.ignoredItemIds })
                }
              : undefined
        })
        await refresh()
      },
      onError: (error) =>
        toast.error('忽略失败', { description: archiveClientErrorMessage(error, '所选结果暂时无法忽略。') })
    })
  )

  const source = detail?.source
  const loadMoreItems = useCallback(() => void itemsQuery.fetchNextPage(), [itemsQuery.fetchNextPage])
  const retryItems = useCallback(() => void itemsQuery.refetch(), [itemsQuery.refetch])
  const loadMoreIgnoredItems = useCallback(
    () => void ignoredItemsQuery.fetchNextPage(),
    [ignoredItemsQuery.fetchNextPage]
  )
  const retryIgnoredItems = useCallback(() => void ignoredItemsQuery.refetch(), [ignoredItemsQuery.refetch])
  const submittableItems = items.filter(isSubmittableItem)
  const bulkSelectableItems = submittableItems.slice(0, MAX_SELECTED_ITEMS)
  const allActionableSelected =
    bulkSelectableItems.length > 0 && bulkSelectableItems.every((item) => selectedItemIds.has(item.id))
  const bulkSelectableIgnoredItems = ignoredItems.slice(0, MAX_SELECTED_ITEMS)
  const allIgnoredSelected =
    bulkSelectableIgnoredItems.length > 0 &&
    bulkSelectableIgnoredItems.every((item) => selectedIgnoredItemIds.has(item.id))
  const mutationPending =
    scanMutation.isPending ||
    cancelMutation.isPending ||
    archiveMutation.isPending ||
    addMutation.isPending ||
    submissionAttemptMutation.isPending ||
    ignoreMutation.isPending ||
    restoreMutation.isPending

  return (
    <div className="flex flex-col gap-6 pt-4">
      <AdminSectionHeader
        title="E-Hentai 发现来源"
        description="保存上传者或标题关键词条件；每次手动扫描，确认结果后才进入归档收件箱。"
        actions={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              新增上传者
            </Button>
            <Button onClick={() => setSearchDialog({ mode: 'CREATE' })}>
              <PlusIcon data-icon="inline-start" />
              新增关键词
            </Button>
          </>
        }
      />

      <ToggleGroup
        type="single"
        value={sourceFilter}
        onValueChange={(value) => {
          if (value) setSourceFilter(value)
        }}
        variant="outline"
        aria-label="来源类型"
      >
        <ToggleGroupItem value="ALL">全部来源</ToggleGroupItem>
        <ToggleGroupItem value="UPLOADER">上传者</ToggleGroupItem>
        <ToggleGroupItem value="TITLE_QUERY">标题关键词</ToggleGroupItem>
      </ToggleGroup>

      {sourcesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>来源加载失败</AlertTitle>
          <AlertDescription>发现来源仍保存在数据库中，请稍后重新加载。</AlertDescription>
        </Alert>
      ) : sourcesQuery.isPending ? (
        <UploaderSourcesLoading />
      ) : sources.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserSearchIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>暂无此类型的发现来源</EmptyTitle>
            <EmptyDescription>先保存上传者或标题关键词来源，再手动扫描公开画廊。</EmptyDescription>
          </EmptyHeader>
          <Button
            onClick={() => (sourceFilter === 'TITLE_QUERY' ? setSearchDialog({ mode: 'CREATE' }) : setCreateOpen(true))}
          >
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            新增来源
          </Button>
        </Empty>
      ) : (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <ArchiveUploaderSourceList
            sources={sources}
            selectedSourceId={selectedSourceId}
            onCopyUid={(uploaderUid) => void copyArchiveUploaderUid(uploaderUid)}
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
                  <EmptyTitle>请选择发现来源</EmptyTitle>
                  <EmptyDescription>从左侧来源列表选择一项查看扫描记录。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      <PrivacySensitiveText>{source.displayName}</PrivacySensitiveText>
                      {!source.titleQuery && source.uidBindingState === 'UNBOUND' ? (
                        <Badge variant="warning">未绑定 UID</Badge>
                      ) : null}
                      <Badge variant={source.status === 'ACTIVE' ? 'success' : 'muted'}>
                        {source.status === 'ACTIVE' ? '已启用' : '已停用'}
                      </Badge>
                    </CardTitle>
                    <CardDescription className="flex flex-wrap items-center gap-2">
                      {source.titleQuery ? (
                        <span>
                          标题{ARCHIVE_TITLE_MATCH_LABELS[source.titleQuery.matchMode]}「
                          <PrivacySensitiveText>{source.titleQuery.keyword}</PrivacySensitiveText>」 ·{' '}
                          {source.titleQuery.uploaderUid ? `UID ${source.titleQuery.uploaderUid}` : '不限上传者'}
                        </span>
                      ) : source.uploaderUid ? (
                        <>
                          <span>上传者 UID {source.uploaderUid}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="复制上传者 UID"
                            onClick={() => void copyArchiveUploaderUid(source.uploaderUid!)}
                          >
                            <CopyIcon aria-hidden="true" />
                          </Button>
                        </>
                      ) : (
                        <span>
                          按名称：<PrivacySensitiveText>{source.identityValue}</PrivacySensitiveText>
                        </span>
                      )}
                      <span>
                        {source.lastSuccessAt
                          ? `上次成功 ${formatArchiveUploaderTimestamp(source.lastSuccessAt)}`
                          : source.uidBindingState === 'REVALIDATION_REQUIRED'
                            ? '等待重新验证 UID 覆盖'
                            : '尚未完成扫描'}
                      </span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {activeRun ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <Spinner aria-hidden="true" />
                        <span>
                          {activeRun.mode === 'LATEST' ? '最新扫描' : '更早内容扫描'} ·{' '}
                          <PrivacySensitiveText>
                            {scanIdentityLabel(activeRun.searchIdentityKind, activeRun.searchIdentityValue)}
                          </PrivacySensitiveText>{' '}
                          ·{' '}
                          {formatArchiveUploaderTimestamp(activeRun.createdAt)}
                        </span>
                        <Badge variant="warning">{scanRunStatusLabel(activeRun.status)}</Badge>
                      </div>
                    ) : latestRun ? (
                      <p className="text-sm text-muted-foreground">
                        最近运行 · {latestRun.mode === 'LATEST' ? '最新扫描' : '更早内容'} ·{' '}
                        <PrivacySensitiveText>
                          {scanIdentityLabel(latestRun.searchIdentityKind, latestRun.searchIdentityValue)}
                        </PrivacySensitiveText>{' '}
                        ·{' '}
                        {formatArchiveUploaderTimestamp(latestRun.createdAt)} · {scanRunStatusLabel(latestRun.status)} ·{' '}
                        {source.titleQuery
                          ? `检查 ${latestRun.checkedCount} 条，匹配 ${latestRun.matchedCount} 条`
                          : `${latestRun.itemCount} 条`}
                        {latestRun.stopReason ? ` · ${scanStopReasonLabel(latestRun.stopReason)}` : ''}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2" aria-label="扫描覆盖状态">
                      {source.uidBindingState === 'REVALIDATION_REQUIRED' ? (
                        <Badge variant="warning">UID 覆盖：待重新验证</Badge>
                      ) : (
                        <>
                          <Badge variant={source.latestCoverage === 'HAS_MORE' ? 'warning' : 'muted'}>
                            最新：{latestCoverageLabel(source.latestCoverage)}
                          </Badge>
                          <Badge variant={source.historyCoverage === 'HAS_MORE' ? 'info' : 'muted'}>
                            历史：{historyCoverageLabel(source.historyCoverage)}
                          </Badge>
                        </>
                      )}
                      <Badge variant={source.catalogCounts.actionable > 0 ? 'success' : 'muted'}>
                        待处理 {source.catalogCounts.actionable}
                      </Badge>
                      {source.catalogCounts.processing > 0 ? (
                        <Badge variant="warning">处理中 {source.catalogCounts.processing}</Badge>
                      ) : null}
                    </div>
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
                            停用来源
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
                      {source.titleQuery ? (
                        <>
                          <Button variant="outline" onClick={() => setSearchDialog({ mode: 'RENAME', source })}>
                            修改名称
                          </Button>
                          <Button variant="outline" onClick={() => setSearchDialog({ mode: 'COPY', source })}>
                            另存条件
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => setUidDialogOpen(true)}
                          disabled={Boolean(activeRun) || mutationPending}
                        >
                          <FingerprintIcon data-icon="inline-start" aria-hidden="true" />
                          {source.uploaderUid ? '更正 UID' : '绑定 UID'}
                        </Button>
                      )}
                    </div>
                    {activeRun && !source.titleQuery ? (
                      <p className="text-sm text-muted-foreground">扫描完成或取消后才能绑定或更正 UID。</p>
                    ) : null}
                  </CardContent>
                </Card>

                {source.uidBindingState === 'REVALIDATION_REQUIRED' ? (
                  <Alert variant="info">
                    <InfoIcon aria-hidden="true" />
                    <AlertTitle>UID 覆盖待校验</AlertTitle>
                    <AlertDescription>
                      现有目录、收件箱关联和归档状态仍然有效。请从“扫描最新”开始，继续扫描到远端末尾以完成 UID
                      覆盖验证；重复 GID 只会更新原目录项。
                    </AlertDescription>
                  </Alert>
                ) : null}

                {source.titleQuery ? (
                  <Alert>
                    <AlertTitle>仅筛选远端返回的标题</AlertTitle>
                    <AlertDescription>
                      每批最多检查 100 条；零匹配不代表后面没有内容。可继续扫描更早内容，不会自动下载。
                    </AlertDescription>
                  </Alert>
                ) : null}
                {source.lastErrorMessage ? (
                  source.lastErrorCode === 'UPLOADER_UID_CONFLICT' ? (
                    <ArchiveUploaderUidConflictAlert message={source.lastErrorMessage} />
                  ) : (
                    <Alert variant="destructive">
                      <AlertTitle>上次扫描未完成</AlertTitle>
                      <PrivacySensitiveText as={AlertDescription}>{source.lastErrorMessage}</PrivacySensitiveText>
                    </Alert>
                  )
                ) : null}

                <AdminSectionHeader
                  className="sm:flex-col sm:items-stretch"
                  title={resultFeedLabel(resultFeed)}
                  description={resultFeedDescription(resultFeed, items.length, ignoredItems.length)}
                  actions={
                    <>
                      <ToggleGroup
                        type="single"
                        value={resultFeed}
                        onValueChange={(value) => value && setResultFeed(value as ResultFeed)}
                        variant="outline"
                        size="sm"
                        aria-label="结果范围"
                        className="max-w-full overflow-x-auto"
                      >
                        {RESULT_FEEDS.map((feed) => (
                          <ToggleGroupItem key={feed.value} value={feed.value} aria-label={`查看${feed.label}`}>
                            {feed.label}
                            {feed.value === 'IGNORED'
                              ? ''
                              : ` ${archiveUploaderCatalogViewCount(source.catalogCounts, feed.value)}`}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      <ArchiveUploaderResultViewToggle value={resultView} onChange={setResultView} />
                      {resultFeed === 'ACTIONABLE' || resultFeed === 'ATTENTION' || resultFeed === 'ALL' ? (
                        <>
                          <Button
                            variant="outline"
                            onClick={() =>
                              ignoreMutation.mutate({ sourceId: source.id, itemIds: [...selectedItemIds] })
                            }
                            disabled={selectedItemIds.size === 0 || mutationPending}
                          >
                            {ignoreMutation.isPending ? (
                              <Spinner data-icon="inline-start" />
                            ) : (
                              <BanIcon data-icon="inline-start" />
                            )}
                            忽略（{selectedItemIds.size}）
                          </Button>
                          <Button
                            onClick={() =>
                              submissionAttemptMutation.mutate({
                                sourceId: source.id,
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
                            {resultFeed === 'ATTENTION' ? '重新加入收件箱' : '加入收件箱'}（{selectedItemIds.size}）
                          </Button>
                        </>
                      ) : resultFeed === 'IGNORED' ? (
                        <Button
                          variant="outline"
                          onClick={() => restoreMutation.mutate({ ignoredItemIds: [...selectedIgnoredItemIds] })}
                          disabled={selectedIgnoredItemIds.size === 0 || mutationPending}
                        >
                          {restoreMutation.isPending ? (
                            <Spinner data-icon="inline-start" />
                          ) : (
                            <RotateCcwIcon data-icon="inline-start" />
                          )}
                          恢复（{selectedIgnoredItemIds.size}）
                        </Button>
                      ) : null}
                    </>
                  }
                />
                {resultFeed !== 'IGNORED' ? (
                  <ScanResults
                    view={resultFeed}
                    runs={detail.runs}
                    activeRun={activeRun}
                    items={items}
                    resultView={resultView}
                    isLoading={itemsQuery.isLoading}
                    isError={itemsQuery.isError}
                    hasNextPage={itemsQuery.hasNextPage}
                    isFetchingNextPage={itemsQuery.isFetchingNextPage}
                    onLoadMore={loadMoreItems}
                    onRetry={retryItems}
                    onPreview={setPreviewItem}
                    onIgnore={(itemId) => ignoreMutation.mutate({ sourceId: source.id, itemIds: [itemId] })}
                    onAdd={(itemId) => submissionAttemptMutation.mutate({ sourceId: source.id, itemIds: [itemId] })}
                    mutationPending={mutationPending}
                    selectedItemIds={selectedItemIds}
                    allActionableSelected={allActionableSelected}
                    onToggleAll={(checked) =>
                      setSelectedItemIds(checked ? new Set(bulkSelectableItems.map(({ id }) => id)) : new Set())
                    }
                    onToggle={(itemId, checked) =>
                      setSelectedItemIds((current) => toggleSelection(current, itemId, checked))
                    }
                  />
                ) : (
                  <IgnoredResults
                    items={ignoredItems}
                    resultView={resultView}
                    isLoading={ignoredItemsQuery.isLoading}
                    isError={ignoredItemsQuery.isError}
                    hasNextPage={ignoredItemsQuery.hasNextPage}
                    isFetchingNextPage={ignoredItemsQuery.isFetchingNextPage}
                    onLoadMore={loadMoreIgnoredItems}
                    onRetry={retryIgnoredItems}
                    onPreview={setPreviewItem}
                    onRestore={(ignoredItemId) => restoreMutation.mutate({ ignoredItemIds: [ignoredItemId] })}
                    mutationPending={mutationPending}
                    selectedItemIds={selectedIgnoredItemIds}
                    allSelected={allIgnoredSelected}
                    onToggleAll={(checked) =>
                      setSelectedIgnoredItemIds(
                        checked ? new Set(bulkSelectableIgnoredItems.map(({ id }) => id)) : new Set()
                      )
                    }
                    onToggle={(itemId, checked) =>
                      setSelectedIgnoredItemIds((current) => toggleSelection(current, itemId, checked))
                    }
                  />
                )}
              </>
            )}
          </AdminSection>
        </div>
      )}

      <ArchiveSearchSourceDialog
        state={searchDialog}
        onClose={() => setSearchDialog(null)}
        onSaved={async (sourceId) => {
          setSourceFilter('ALL')
          await refresh()
          setSelectedSourceId(sourceId)
          setSelectedItemIds(new Set())
        }}
      />
      <ArchiveUploaderCreateSourceDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={refresh} />
      <ArchiveUploaderUidDialog
        source={source?.titleQuery ? null : (source ?? null)}
        open={uidDialogOpen && !source?.titleQuery}
        onOpenChange={setUidDialogOpen}
        onUpdated={refresh}
        onConflict={(sourceId) => {
          setSelectedSourceId(sourceId)
          setSelectedItemIds(new Set())
          setCancelRequestedRunId(null)
        }}
      />
      <ArchiveUploaderGalleryPreviewDialog item={previewItem} onOpenChange={(open) => !open && setPreviewItem(null)} />
    </div>
  )
}

function ScanResults({
  view,
  runs,
  activeRun,
  items,
  resultView,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onRetry,
  onPreview,
  onIgnore,
  onAdd,
  mutationPending,
  selectedItemIds,
  allActionableSelected,
  onToggleAll,
  onToggle
}: {
  view: CatalogView
  runs: ScanRun[]
  activeRun?: ScanRun
  items: ScanItem[]
  resultView: ArchiveUploaderResultView
  isLoading: boolean
  isError: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  onRetry: () => void
  onPreview: (item: ArchiveUploaderPreviewItem) => void
  onIgnore: (itemId: string) => void
  onAdd: (itemId: string) => void
  mutationPending: boolean
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
  if (items.length === 0) {
    const neverScanned = runs.length === 0
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>
            {activeRun ? '正在扫描' : neverScanned ? '尚无扫描记录' : `没有${resultFeedLabel(view)}项目`}
          </EmptyTitle>
          <EmptyDescription>
            {activeRun
              ? '任务完成后，画廊会自动汇入长期目录。'
              : neverScanned
                ? '点击“扫描最新”创建第一批发现结果。'
                : emptyCatalogViewDescription(view)}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid min-h-12 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 border-b bg-muted/30 px-4 text-xs font-medium text-muted-foreground sm:grid-cols-[2.5rem_minmax(0,1fr)_9rem_8rem_5rem]">
        <Checkbox
          checked={allActionableSelected ? true : selectedItemIds.size > 0 ? 'indeterminate' : false}
          onCheckedChange={(checked) => onToggleAll(checked === true)}
          aria-label="选择当前已加载的可加入结果，最多一百条"
        />
        <span>画廊</span>
        <span className="hidden sm:block">发布时间</span>
        <span className="hidden sm:block">判断</span>
        <span className="hidden sm:block">操作</span>
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
                    className="grid min-h-20 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_9rem_8rem_5rem]"
                    data-state={selectedItemIds.has(item.id) ? 'selected' : undefined}
                  >
                    <Checkbox
                      checked={selectedItemIds.has(item.id)}
                      disabled={
                        !isSubmittableItem(item) ||
                        (!selectedItemIds.has(item.id) && selectedItemIds.size >= MAX_SELECTED_ITEMS)
                      }
                      onCheckedChange={(checked) => onToggle(item.id, checked === true)}
                      aria-label={`选择 ${item.title}`}
                    />
                    <div className="flex min-w-0 items-center gap-3">
                      {resultView === 'preview' ? (
                        <ArchiveUploaderGalleryThumbnail key={item.id} item={item} onPreview={onPreview} />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <PrivacySensitiveText as="p" className="line-clamp-2 font-medium">
                            {item.title}
                          </PrivacySensitiveText>
                          <span className="shrink-0 sm:hidden">
                            <CatalogStatusBadge item={item} />
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          E-Hentai #{item.externalId} · <PrivacySensitiveText>{item.displayUrl}</PrivacySensitiveText>
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                          {item.postedAt ? formatArchiveUploaderTimestamp(item.postedAt) : '发布时间未知'}
                        </p>
                        {item.changeReasons.length > 0 ? (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {item.changeReasons.map(({ label }) => label).join(' · ')}
                          </p>
                        ) : item.workflowStage === 'ARCHIVED' && !item.comparisonKnown ? (
                          <p className="mt-1 text-xs text-muted-foreground">旧记录缺少比较快照，下次扫描会补齐</p>
                        ) : item.errorMessage ? (
                          <PrivacySensitiveText as="p" className="mt-1 line-clamp-2 text-xs text-destructive">
                            {item.errorMessage}
                          </PrivacySensitiveText>
                        ) : null}
                      </div>
                    </div>
                    <p className="hidden whitespace-nowrap text-sm text-muted-foreground sm:block">
                      {item.postedAt ? formatArchiveUploaderTimestamp(item.postedAt) : '—'}
                    </p>
                    <span className="hidden sm:block">
                      <CatalogStatusBadge item={item} />
                    </span>
                    {isActionableItem(item) ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onIgnore(item.id)}
                        disabled={mutationPending}
                        aria-label={`忽略 ${item.title}`}
                      >
                        <BanIcon aria-hidden="true" />
                      </Button>
                    ) : item.workflowBucket === 'ATTENTION' && item.intakeItemId ? (
                      <Button variant="ghost" size="icon" asChild aria-label={`去收件箱处理 ${item.title}`}>
                        <Link href={`/admin/archive/inbox?itemId=${encodeURIComponent(item.intakeItemId)}`}>
                          <ArrowUpRightIcon aria-hidden="true" />
                        </Link>
                      </Button>
                    ) : item.recoverable ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onAdd(item.id)}
                        disabled={mutationPending}
                        aria-label={`重新加入收件箱 ${item.title}`}
                      >
                        <RotateCcwIcon aria-hidden="true" />
                      </Button>
                    ) : item.workflowStage === 'ARCHIVED' && item.artworkId ? (
                      <Button variant="ghost" size="icon" asChild aria-label={`查看已归档作品 ${item.title}`}>
                        <Link href={`/artworks/${item.artworkId}`} target="_blank" rel="noreferrer">
                          <ArrowUpRightIcon aria-hidden="true" />
                        </Link>
                      </Button>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-20 items-center justify-center gap-2 text-sm text-muted-foreground">
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

function CatalogStatusBadge({ item }: { item: ScanItem }) {
  const states = {
    NEW: { label: '新归档', variant: 'success' as const },
    UPDATE_AVAILABLE: { label: '可能更新', variant: 'info' as const },
    REPLACEMENT: { label: '替代版本', variant: 'warning' as const },
    INBOX: { label: '等待解析', variant: 'warning' as const },
    READY: { label: '待确认入队', variant: 'info' as const },
    DOWNLOADING: { label: '下载中', variant: 'warning' as const },
    ARCHIVED: { label: item.comparisonKnown ? '已归档' : '已归档 · 待校验', variant: 'muted' as const },
    FAILED: { label: '处理失败', variant: 'destructive' as const },
    CANCELLED: { label: '已取消', variant: 'muted' as const },
    DUPLICATE: { label: '身份重复', variant: 'warning' as const }
  }
  const state = states[item.workflowStage]
  return <Badge variant={state.variant}>{state.label}</Badge>
}

function isActionableItem(item: ScanItem) {
  return item.actionable
}

function isSubmittableItem(item: ScanItem) {
  return item.actionable || item.recoverable
}

function resultFeedLabel(feed: ResultFeed) {
  return RESULT_FEEDS.find(({ value }) => value === feed)?.label ?? '上传者目录'
}

function resultFeedDescription(feed: ResultFeed, itemCount: number, ignoredCount: number) {
  if (feed === 'IGNORED') return `跨所有来源永久忽略的画廊；已加载 ${ignoredCount} 条。`
  const descriptions: Record<CatalogView, string> = {
    ACTIONABLE: '尚未处理，或本地版本与当前公开信息存在稳定差异',
    PROCESSING: '正在收件箱解析、等待确认或执行下载',
    ARCHIVED: '已经完成下载并发布到本地归档',
    ATTENTION: '解析、下载或身份检查需要处理',
    ALL: '这个来源长期保留的全部已发现画廊'
  }
  return `${descriptions[feed]}；已加载 ${itemCount} 条。`
}

function emptyCatalogViewDescription(view: CatalogView) {
  return {
    ACTIONABLE: '当前没有需要决定是否归档的画廊。',
    PROCESSING: '当前没有正在解析或下载的画廊。',
    ARCHIVED: '这个来源还没有完成归档的画廊。',
    ATTENTION: '当前没有需要处理的异常。',
    ALL: '已完成的扫描暂未发现公开画廊。'
  }[view]
}

function toggleSelection(current: Set<string>, itemId: string, checked: boolean) {
  const next = new Set(current)
  if (checked && next.size < MAX_SELECTED_ITEMS) next.add(itemId)
  else next.delete(itemId)
  return next
}

function removeInfiniteItems<TPage extends { items: Array<{ id: string }> }>(
  current: InfiniteData<TPage> | undefined,
  itemIds: string[]
) {
  if (!current) return current
  const removed = new Set(itemIds)
  return {
    ...current,
    pages: current.pages.map((page) => ({ ...page, items: page.items.filter((item) => !removed.has(item.id)) }))
  }
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
