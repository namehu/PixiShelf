'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  BanIcon,
  InfoIcon,
  PlusIcon,
  RotateCcwIcon,
  UserSearchIcon
} from 'lucide-react'
import { toast } from 'sonner'
import type { AppRouter } from '@/server'
import { useTRPC } from '@/lib/trpc'
import { useMediaQuery } from '@/hooks/use-media-query'
import { AdminSection, AdminSectionHeader } from '@/app/admin/_components/admin-workbench'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { SourcePreviewButton } from '@/components/source-preview/source-preview-button'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { type ArchiveUploaderResultView, useAdminPreferencesStore } from '@/store/admin/use-admin-preferences-store'
import { ArchiveDiscoveryBulkBar } from './archive-discovery-bulk-bar'
import { ArchiveDiscoveryDeleteDialog } from './archive-discovery-delete-dialog'
import { ArchiveDiscoveryDetailHeader } from './archive-discovery-detail-header'
import { IgnoredResults } from './archive-discovery-ignored-results'
import { ArchiveDiscoveryResultList, type ArchiveDiscoveryListPosition } from './archive-discovery-result-list'
import {
  ArchiveDiscoveryResultsToolbar,
  type ArchiveDiscoveryCatalogView,
  resultFeedLabel
} from './archive-discovery-results-toolbar'
import { DEFAULT_ARCHIVE_INTAKE_OPTIONS } from './archive-intake-options'
import { ArchiveSearchSourceDialog, type ArchiveSearchDialogState } from './archive-search-source-dialog'
import { copyArchiveUploaderUid } from './archive-uploader-clipboard'
import { ArchiveUploaderCreateSourceDialog } from './archive-uploader-create-source-dialog'
import {
  ArchiveUploaderGalleryPreviewDialog,
  ArchiveUploaderGalleryThumbnail,
  type ArchiveUploaderPreviewItem,
  ArchiveUploaderResultViewToggle
} from './archive-uploader-result-visuals'
import { ArchiveUploaderSourceList } from './archive-uploader-source-list'
import { ArchiveUploaderUidConflictAlert } from './archive-uploader-uid-conflict-alert'
import { ArchiveUploaderUidDialog } from './archive-uploader-uid-dialog'
import {
  archiveUploaderDetailPollingInterval,
  formatArchiveUploaderTimestamp,
  isActiveArchiveUploaderRunStatus
} from './archive-uploader-view-state'

type RouterOutputs = inferRouterOutputs<AppRouter>
type ScanItem = RouterOutputs['archiveSearch']['listItems']['items'][number]
type ScanItemsPage = RouterOutputs['archiveSearch']['listItems']
type IgnoredItemsPage = RouterOutputs['archiveSearch']['listIgnoredItems']
type ScanRun = RouterOutputs['archiveSearch']['getSource']['runs'][number]
type NavigationHistory = 'push' | 'replace'

const SCAN_RESULT_PAGE_SIZE = 50
const MAX_SELECTED_ITEMS = 100
const isSubmittableItem = (item: ScanItem) => item.actionable || item.recoverable

export function ArchiveUploaderSources({
  active,
  locatedSourceId,
  ignored,
  onNavigateSource,
  onNavigateSourceList,
  onNavigateIgnored,
  onNavigateInboxItem
}: {
  active: boolean
  locatedSourceId: string | null
  ignored: boolean
  onNavigateSource: (sourceId: string, history: NavigationHistory) => void
  onNavigateSourceList: (history: NavigationHistory) => void
  onNavigateIgnored: (ignored: boolean, history: NavigationHistory) => void
  onNavigateInboxItem: (itemId: string) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [layoutReady, setLayoutReady] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteSourceId, setDeleteSourceId] = useState<string | null>(null)
  const [searchDialog, setSearchDialog] = useState<ArchiveSearchDialogState | null>(null)
  const [sourceFilter, setSourceFilter] = useState('ALL')
  const [uidDialogOpen, setUidDialogOpen] = useState(false)
  const [implicitSourceId, setImplicitSourceId] = useState<string | null>(null)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [intakeOptions, setIntakeOptions] = useState(DEFAULT_ARCHIVE_INTAKE_OPTIONS)
  const [selectedIgnoredItemIds, setSelectedIgnoredItemIds] = useState<Set<string>>(new Set())
  const [resultFeed, setResultFeed] = useState<ArchiveDiscoveryCatalogView>('ACTIONABLE')
  const [previewItem, setPreviewItem] = useState<ArchiveUploaderPreviewItem | null>(null)
  const [cancelRequestedRunId, setCancelRequestedRunId] = useState<string | null>(null)
  const activeDraftSourceIdRef = useRef<string | null>(null)
  const enteredFromListRef = useRef(false)
  const ignoredEnteredFromListRef = useRef(false)
  const resultPositionsRef = useRef(new Map<string, ArchiveDiscoveryListPosition>())
  const sourceListScrollRef = useRef(0)
  const previousMobileViewRef = useRef<string | null>(null)
  const refreshedCompletedRunId = useRef<string | null>(null)
  const previousProcessingCount = useRef<{ sourceId: string; count: number } | null>(null)
  const resultView = useAdminPreferencesStore((state) => state.archiveUploaderResultView)
  const setResultView = useAdminPreferencesStore((state) => state.setArchiveUploaderResultView)

  useEffect(() => setLayoutReady(true), [])

  useEffect(() => {
    void useAdminPreferencesStore.persist.rehydrate()
  }, [])

  const sourcesQuery = useQuery(
    trpc.archiveSearch.listSources.queryOptions(
      { includeArchived: true },
      {
        enabled: active,
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
  const allSources = sourcesQuery.data ?? []
  const sources = useMemo(
    () => allSources.filter((source) => sourceFilter === 'ALL' || (source.sourceKind ?? 'UPLOADER') === sourceFilter),
    [allSources, sourceFilter]
  )

  useEffect(() => {
    if (!active || !layoutReady || !isDesktop || locatedSourceId) return
    setImplicitSourceId((current) =>
      current && sources.some(({ id }) => id === current) ? current : (sources[0]?.id ?? null)
    )
  }, [active, isDesktop, layoutReady, locatedSourceId, sources])

  useEffect(() => {
    if (locatedSourceId) setImplicitSourceId(locatedSourceId)
  }, [locatedSourceId])

  const selectedSourceId = locatedSourceId ?? (isDesktop ? implicitSourceId : null)

  useLayoutEffect(() => {
    if (!active || !layoutReady || isDesktop || sourcesQuery.isPending) return
    const view = ignored ? 'ignored' : (locatedSourceId ?? 'list')
    const previous = previousMobileViewRef.current
    previousMobileViewRef.current = view
    if (previous && previous !== view) {
      window.scrollTo({ top: view === 'list' ? sourceListScrollRef.current : 0 })
    }
    if (view !== 'list') return
    const save = () => {
      sourceListScrollRef.current = window.scrollY
    }
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [active, ignored, isDesktop, layoutReady, locatedSourceId, sourcesQuery.isPending])

  useEffect(() => {
    if (!selectedSourceId) return
    const previousSourceId = activeDraftSourceIdRef.current
    if (previousSourceId && previousSourceId !== selectedSourceId) {
      setSelectedItemIds(new Set())
      setIntakeOptions(DEFAULT_ARCHIVE_INTAKE_OPTIONS)
      setResultFeed('ACTIONABLE')
      setPreviewItem(null)
      setCancelRequestedRunId(null)
    }
    activeDraftSourceIdRef.current = selectedSourceId
  }, [selectedSourceId])

  const detailQuery = useQuery(
    trpc.archiveSearch.getSource.queryOptions(
      { sourceId: selectedSourceId ?? 'unselected' },
      {
        enabled: active && Boolean(selectedSourceId),
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
      { sourceId: selectedSourceId ?? 'unselected', view: resultFeed, limit: SCAN_RESULT_PAGE_SIZE },
      {
        initialCursor: null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: active && Boolean(selectedSourceId),
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
        enabled: active && ignored
      }
    )
  )
  const ignoredItems = useMemo(
    () => ignoredItemsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [ignoredItemsQuery.data]
  )

  useEffect(() => {
    if (latestRun?.status !== 'COMPLETED' || refreshedCompletedRunId.current === latestRun.id) return
    refreshedCompletedRunId.current = latestRun.id
    void queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listItems.infiniteQueryKey() })
  }, [latestRun?.id, latestRun?.status, queryClient, trpc.archiveSearch.listItems])

  useEffect(() => {
    if (!selectedSourceId || !detail) return
    const count = detail.source.catalogCounts.processing
    const previous = previousProcessingCount.current
    previousProcessingCount.current = { sourceId: selectedSourceId, count }
    if (previous?.sourceId !== selectedSourceId || previous.count === 0 || count !== 0) return
    void queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listItems.infiniteQueryKey() })
  }, [detail, queryClient, selectedSourceId, trpc.archiveSearch.listItems])

  useEffect(() => {
    if (!cancelRequestedRunId) return
    if (!activeRun || activeRun.id !== cancelRequestedRunId) setCancelRequestedRunId(null)
  }, [activeRun, cancelRequestedRunId])

  useEffect(() => {
    if (!selectedSourceId || !itemsQuery.isSuccess) return
    setSelectedItemIds((current) => {
      const available = new Set(items.filter(isSubmittableItem).map(({ id }) => id))
      return new Set([...current].filter((id) => available.has(id)))
    })
  }, [items, itemsQuery.isSuccess, selectedSourceId])

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
        toast.error('扫描启动失败', { description: archiveClientErrorMessage(error, '暂时无法启动来源扫描。') })
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
        setIntakeOptions(DEFAULT_ARCHIVE_INTAKE_OPTIONS)
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
        toast.error('无法创建提交尝试', { description: archiveClientErrorMessage(error, '请刷新页面后重试。') })
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
              ? { label: '撤销', onClick: () => restoreMutation.mutate({ ignoredItemIds: result.ignoredItemIds }) }
              : undefined
        })
        await refresh()
      },
      onError: (error) =>
        toast.error('忽略失败', { description: archiveClientErrorMessage(error, '所选结果暂时无法忽略。') })
    })
  )

  const loadMoreItems = useCallback(() => void itemsQuery.fetchNextPage(), [itemsQuery.fetchNextPage])
  const retryItems = useCallback(() => void itemsQuery.refetch(), [itemsQuery.refetch])
  const loadMoreIgnoredItems = useCallback(
    () => void ignoredItemsQuery.fetchNextPage(),
    [ignoredItemsQuery.fetchNextPage]
  )
  const retryIgnoredItems = useCallback(() => void ignoredItemsQuery.refetch(), [ignoredItemsQuery.refetch])
  const saveResultPosition = useCallback((key: string, position: ArchiveDiscoveryListPosition) => {
    resultPositionsRef.current.set(key, position)
  }, [])

  const enterSource = useCallback(
    (sourceId: string) => {
      if (activeDraftSourceIdRef.current && activeDraftSourceIdRef.current !== sourceId) {
        setSelectedItemIds(new Set())
        setIntakeOptions(DEFAULT_ARCHIVE_INTAKE_OPTIONS)
        setResultFeed('ACTIONABLE')
        setPreviewItem(null)
        setCancelRequestedRunId(null)
      }
      activeDraftSourceIdRef.current = sourceId
      setImplicitSourceId(sourceId)
      if (!locatedSourceId && !ignored) {
        sourceListScrollRef.current = window.scrollY
        enteredFromListRef.current = true
        onNavigateSource(sourceId, 'push')
      } else {
        onNavigateSource(sourceId, locatedSourceId ? 'replace' : 'push')
      }
    },
    [ignored, locatedSourceId, onNavigateSource]
  )

  const returnToSourceList = useCallback(() => {
    if (enteredFromListRef.current && window.history.length > 1) window.history.back()
    else onNavigateSourceList('replace')
  }, [onNavigateSourceList])

  const enterIgnored = () => {
    ignoredEnteredFromListRef.current = true
    setSelectedIgnoredItemIds(new Set())
    onNavigateIgnored(true, 'push')
  }
  const returnFromIgnored = () => {
    if (ignoredEnteredFromListRef.current && window.history.length > 1) window.history.back()
    else onNavigateIgnored(false, 'replace')
  }

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
  const mobileDetail = layoutReady && !isDesktop && (ignored || Boolean(locatedSourceId))

  if (!active) return null

  const globalHeader = !mobileDetail ? (
    <>
      <AdminSectionHeader
        title="发现来源"
        description="保存上传者或标题关键词条件；手动扫描并勾选结果，再按所选模式加入收件箱。"
        actions={
          <>
            <Button
              variant="outline"
              aria-label={ignored ? '返回发现来源' : '查看全局已忽略'}
              onClick={ignored ? returnFromIgnored : enterIgnored}
            >
              {ignored ? (
                <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              ) : (
                <BanIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {ignored ? '返回发现来源' : '全局已忽略'}
            </Button>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              新增上传者
            </Button>
            <Button onClick={() => setSearchDialog({ mode: 'CREATE' })}>
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              新增关键词
            </Button>
          </>
        }
      />
      {!ignored ? (
        <ToggleGroup
          type="single"
          value={sourceFilter}
          onValueChange={(value) => value && setSourceFilter(value)}
          variant="outline"
          aria-label="来源类型"
        >
          <ToggleGroupItem value="ALL">全部来源</ToggleGroupItem>
          <ToggleGroupItem value="UPLOADER">上传者</ToggleGroupItem>
          <ToggleGroupItem value="TITLE_QUERY">标题关键词</ToggleGroupItem>
        </ToggleGroup>
      ) : null}
    </>
  ) : null

  const sourceList =
    sources.length === 0 ? (
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
      <ArchiveUploaderSourceList
        sources={sources}
        selectedSourceId={selectedSourceId}
        onCopyUid={(uploaderUid) => void copyArchiveUploaderUid(uploaderUid)}
        onSelect={enterSource}
      />
    )

  const source = detail?.source
  const resultPositionKey = selectedSourceId ? `${selectedSourceId}:${resultFeed}` : 'unselected'
  const detailPanel = (
    <AdminSection>
      {mobileDetail ? (
        <Button
          type="button"
          variant="ghost"
          className="sticky top-14 z-20 w-fit bg-background/90 backdrop-blur"
          onClick={returnToSourceList}
        >
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          返回来源列表
        </Button>
      ) : null}
      {(selectedSourceId && detailQuery.isPending) || !layoutReady ? (
        <UploaderDetailLoading />
      ) : detailQuery.isError ? (
        <SourceDetailError
          notFound={(detailQuery.error as { data?: { code?: string } }).data?.code === 'PRECONDITION_FAILED'}
          onRetry={() => void detailQuery.refetch()}
          onReturn={returnToSourceList}
        />
      ) : !source ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>请选择发现来源</EmptyTitle>
            <EmptyDescription>从来源列表选择一项查看扫描记录。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ArchiveDiscoveryDetailHeader
            source={source}
            activeRun={activeRun}
            latestRun={latestRun}
            mutationPending={mutationPending}
            scanPending={scanMutation.isPending}
            cancelPending={cancelMutation.isPending}
            cancelRequested={cancelRequestedRunId === activeRun?.id}
            onScanLatest={() => scanMutation.mutate({ sourceId: source.id, mode: 'LATEST' })}
            onScanHistory={() => scanMutation.mutate({ sourceId: source.id, mode: 'HISTORY' })}
            onCancel={() => activeRun && cancelMutation.mutate({ sourceId: source.id, runId: activeRun.id })}
            onSetArchived={(archived) => archiveMutation.mutate({ sourceId: source.id, archived })}
            onRename={() => setSearchDialog({ mode: 'RENAME', source })}
            onCopy={() => setSearchDialog({ mode: 'COPY', source })}
            onEditUid={() => setUidDialogOpen(true)}
            onDelete={() => setDeleteSourceId(source.id)}
            onCopyUid={() => source.uploaderUid && void copyArchiveUploaderUid(source.uploaderUid)}
          />

          {source.uidBindingState === 'REVALIDATION_REQUIRED' ? (
            <Alert variant="info">
              <InfoIcon aria-hidden="true" />
              <AlertTitle>UID 覆盖待校验</AlertTitle>
              <AlertDescription>
                现有目录、收件箱关联和归档状态仍然有效。请从“扫描最新”开始，继续扫描到远端末尾以完成 UID 覆盖验证；重复
                GID 只会更新原目录项。
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

          <ArchiveDiscoveryResultsToolbar
            view={resultFeed}
            counts={{
              ACTIONABLE: source.catalogCounts.actionable,
              PROCESSING: source.catalogCounts.processing,
              ARCHIVED: source.catalogCounts.archived,
              ATTENTION: source.catalogCounts.attention,
              ALL: source.catalogCounts.total
            }}
            description={resultFeedDescription(resultFeed, items.length)}
            resultView={resultView}
            onViewChange={setResultFeed}
            onResultViewChange={setResultView}
            intakeOptions={intakeOptions}
            onIntakeOptionsChange={setIntakeOptions}
            disabled={mutationPending}
          />
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
            onAdd={(itemId) =>
              submissionAttemptMutation.mutate({ sourceId: source.id, itemIds: [itemId], ...intakeOptions })
            }
            onNavigateInboxItem={onNavigateInboxItem}
            mutationPending={mutationPending}
            selectedItemIds={selectedItemIds}
            allActionableSelected={allActionableSelected}
            onToggleAll={(checked) =>
              setSelectedItemIds(checked ? new Set(bulkSelectableItems.map(({ id }) => id)) : new Set())
            }
            onToggle={(itemId, checked) => setSelectedItemIds((current) => toggleSelection(current, itemId, checked))}
            isDesktop={isDesktop}
            layoutReady={layoutReady}
            positionKey={resultPositionKey}
            position={resultPositionsRef.current.get(resultPositionKey)}
            onPositionChange={(position) => saveResultPosition(resultPositionKey, position)}
          />
          <ArchiveDiscoveryBulkBar
            selectedCount={selectedItemIds.size}
            kind="catalog"
            pending={mutationPending}
            ignoreDisabled={items.some((item) => selectedItemIds.has(item.id) && !item.actionable)}
            addLabel={resultFeed === 'ATTENTION' ? '重新加入收件箱' : '加入收件箱'}
            onClear={() => setSelectedItemIds(new Set())}
            onIgnore={() => ignoreMutation.mutate({ sourceId: source.id, itemIds: [...selectedItemIds] })}
            onAdd={() =>
              submissionAttemptMutation.mutate({ sourceId: source.id, itemIds: [...selectedItemIds], ...intakeOptions })
            }
          />
        </>
      )}
    </AdminSection>
  )

  return (
    <div className="flex min-w-0 flex-col gap-6 pt-4">
      {globalHeader}
      {ignored ? (
        <AdminSection>
          {mobileDetail ? (
            <Button
              type="button"
              variant="ghost"
              className="sticky top-14 z-20 w-fit bg-background/90 backdrop-blur"
              onClick={returnFromIgnored}
            >
              <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              返回来源列表
            </Button>
          ) : null}
          <AdminSectionHeader
            title="全局已忽略"
            description={`跨所有来源永久忽略的画廊；已加载 ${ignoredItems.length} 条。`}
            actions={<ArchiveUploaderResultViewToggle value={resultView} onChange={setResultView} />}
          />
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
              setSelectedIgnoredItemIds(checked ? new Set(bulkSelectableIgnoredItems.map(({ id }) => id)) : new Set())
            }
            onToggle={(itemId, checked) =>
              setSelectedIgnoredItemIds((current) => toggleSelection(current, itemId, checked))
            }
            isDesktop={isDesktop}
            layoutReady={layoutReady}
            position={resultPositionsRef.current.get('ignored')}
            onPositionChange={(position) => saveResultPosition('ignored', position)}
          />
          <ArchiveDiscoveryBulkBar
            selectedCount={selectedIgnoredItemIds.size}
            kind="ignored"
            pending={mutationPending}
            onClear={() => setSelectedIgnoredItemIds(new Set())}
            onRestore={() => restoreMutation.mutate({ ignoredItemIds: [...selectedIgnoredItemIds] })}
          />
        </AdminSection>
      ) : sourcesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>来源加载失败</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>发现来源仍保存在数据库中，请稍后重新加载。</span>
            <Button variant="outline" size="sm" onClick={() => void sourcesQuery.refetch()}>
              重新加载
            </Button>
          </AlertDescription>
        </Alert>
      ) : sourcesQuery.isPending || !layoutReady ? (
        <UploaderSourcesLoading />
      ) : isDesktop ? (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)]">
          {sourceList}
          {detailPanel}
        </div>
      ) : locatedSourceId ? (
        detailPanel
      ) : (
        sourceList
      )}

      {deleteSourceId ? (
        <ArchiveDiscoveryDeleteDialog
          key={deleteSourceId}
          sourceId={deleteSourceId}
          onClose={() => setDeleteSourceId(null)}
          onDeleted={async (deletedSourceId) => {
            setImplicitSourceId(null)
            setSelectedItemIds(new Set())
            setPreviewItem(null)
            setCancelRequestedRunId(null)
            setUidDialogOpen(false)
            setSearchDialog(null)
            activeDraftSourceIdRef.current = null
            await Promise.all([
              queryClient.cancelQueries({
                queryKey: trpc.archiveSearch.getSource.queryKey({ sourceId: deletedSourceId })
              }),
              queryClient.cancelQueries({
                queryKey: trpc.archiveSearch.listItems.infiniteQueryKey({ sourceId: deletedSourceId })
              })
            ])
            queryClient.setQueriesData<RouterOutputs['archiveSearch']['listSources']>(
              { queryKey: trpc.archiveSearch.listSources.queryKey() },
              (current) => current?.filter(({ id }) => id !== deletedSourceId)
            )
            queryClient.removeQueries({
              queryKey: trpc.archiveSearch.getSource.queryKey({ sourceId: deletedSourceId })
            })
            queryClient.removeQueries({
              queryKey: trpc.archiveSearch.listItems.infiniteQueryKey({ sourceId: deletedSourceId })
            })
            onNavigateSourceList('replace')
            toast.success('发现来源已删除，已入箱项目和本地作品已保留')
            await refresh()
          }}
        />
      ) : null}
      <ArchiveSearchSourceDialog
        state={searchDialog}
        onClose={() => setSearchDialog(null)}
        onSaved={async (sourceId) => {
          setSourceFilter('ALL')
          await refresh()
          enterSource(sourceId)
        }}
      />
      <ArchiveUploaderCreateSourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (sourceId) => {
          setSourceFilter('ALL')
          await refresh()
          enterSource(sourceId)
        }}
      />
      <ArchiveUploaderUidDialog
        source={source?.titleQuery ? null : (source ?? null)}
        open={uidDialogOpen && !source?.titleQuery}
        onOpenChange={setUidDialogOpen}
        onUpdated={refresh}
        onConflict={(sourceId) => enterSource(sourceId)}
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
  onNavigateInboxItem,
  mutationPending,
  selectedItemIds,
  allActionableSelected,
  onToggleAll,
  onToggle,
  isDesktop,
  layoutReady,
  positionKey,
  position,
  onPositionChange
}: {
  view: ArchiveDiscoveryCatalogView
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
  onNavigateInboxItem: (itemId: string) => void
  mutationPending: boolean
  selectedItemIds: Set<string>
  allActionableSelected: boolean
  onToggleAll: (checked: boolean) => void
  onToggle: (itemId: string, checked: boolean) => void
  isDesktop: boolean
  layoutReady: boolean
  positionKey: string
  position?: ArchiveDiscoveryListPosition
  onPositionChange: (position: ArchiveDiscoveryListPosition) => void
}) {
  const neverScanned = runs.length === 0
  return (
    <ArchiveDiscoveryResultList
      items={items}
      isDesktop={isDesktop}
      layoutReady={layoutReady}
      isLoading={isLoading}
      isError={isError}
      errorTitle="扫描结果加载失败"
      errorDescription="扫描记录仍保存在数据库中，请稍后重试。"
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onLoadMore={onLoadMore}
      onRetry={onRetry}
      positionKey={positionKey}
      position={position}
      onPositionChange={onPositionChange}
      emptyState={
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
      }
      header={
        <div className="grid min-h-12 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b bg-muted/30 px-4 text-xs font-medium text-muted-foreground">
          <Checkbox
            checked={allActionableSelected ? true : selectedItemIds.size > 0 ? 'indeterminate' : false}
            onCheckedChange={(checked) => onToggleAll(checked === true)}
            aria-label="选择当前已加载的可加入结果，最多一百条"
          />
          <span>画廊</span>
          <span className="text-right">操作</span>
        </div>
      }
      renderItem={(item) => (
        <div className="border-b bg-background px-4 py-3">
          <div
            className="grid min-h-20 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3"
            data-state={selectedItemIds.has(item.id) ? 'selected' : undefined}
          >
            <Checkbox
              checked={selectedItemIds.has(item.id)}
              disabled={
                !(item.actionable || item.recoverable) ||
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
                <div className="flex min-w-0 flex-col items-start gap-1.5 sm:flex-row sm:flex-wrap sm:gap-2">
                  <PrivacySensitiveText
                    as="p"
                    className="w-full min-w-0 break-words font-medium sm:w-auto sm:flex-1 sm:line-clamp-2"
                  >
                    {item.title}
                  </PrivacySensitiveText>
                  <CatalogStatusBadge item={item} />
                </div>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  #{item.externalId} · <PrivacySensitiveText>{item.displayUrl}</PrivacySensitiveText>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.postedAt ? formatArchiveUploaderTimestamp(item.postedAt) : '发布时间未知'}
                </p>
                {item.changeReasons.length > 0 ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {item.changeReasons.map(({ label }) => label).join(' · ')}
                  </p>
                ) : item.workflowStage === 'ARCHIVED' && !item.comparisonKnown ? (
                  <p className="mt-1 text-xs text-muted-foreground">旧记录缺少比较快照，下次扫描会补齐</p>
                ) : null}
                {item.errorMessage ? (
                  <PrivacySensitiveText as="p" className="mt-1 line-clamp-2 text-xs text-destructive">
                    {item.errorMessage}
                  </PrivacySensitiveText>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-end">
              <SourcePreviewButton
                source={{ kind: 'catalog', itemId: item.id }}
                variant="ghost"
                size="icon"
                aria-label={`预览原站 ${item.title}`}
              >
                <span className="sr-only">原站预览</span>
              </SourcePreviewButton>
              {item.actionable ? (
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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onNavigateInboxItem(item.intakeItemId!)}
                  aria-label={`去收件箱处理 ${item.title}`}
                >
                  <ArrowUpRightIcon aria-hidden="true" />
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
                  <a href={`/artworks/${item.artworkId}`} target="_blank" rel="noreferrer">
                    <ArrowUpRightIcon aria-hidden="true" />
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    />
  )
}

function SourceDetailError({
  notFound,
  onRetry,
  onReturn
}: {
  notFound: boolean
  onRetry: () => void
  onReturn: () => void
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{notFound ? '这个发现来源已不存在' : '发现来源加载失败'}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {notFound ? '它可能已在其他页面被删除。返回列表选择仍然存在的来源。' : '来源没有被判定为删除；请重试加载。'}
        </span>
        <div className="flex flex-wrap gap-2">
          {!notFound ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              重试
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onReturn}>
            返回来源列表
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}

function CatalogStatusBadge({ item }: { item: ScanItem }) {
  const states = {
    NEW: { label: '新归档', variant: 'success' as const },
    UPDATE_AVAILABLE: { label: '可能更新', variant: 'info' as const },
    REPLACEMENT: { label: '替代版本', variant: 'warning' as const },
    INBOX: { label: '等待解析', variant: 'warning' as const },
    READY: { label: '待确认下载', variant: 'info' as const },
    DOWNLOADING: { label: '下载中', variant: 'warning' as const },
    ARCHIVED: { label: item.comparisonKnown ? '已归档' : '已归档 · 待校验', variant: 'muted' as const },
    FAILED: { label: '处理失败', variant: 'destructive' as const },
    CANCELLED: { label: '已取消', variant: 'muted' as const },
    DUPLICATE: { label: '身份重复', variant: 'warning' as const }
  }
  const state = states[item.workflowStage]
  return <Badge variant={state.variant}>{state.label}</Badge>
}

function resultFeedDescription(feed: ArchiveDiscoveryCatalogView, itemCount: number) {
  const descriptions: Record<ArchiveDiscoveryCatalogView, string> = {
    ACTIONABLE: '尚未处理，或本地版本与当前公开信息存在稳定差异',
    PROCESSING: '正在收件箱解析、等待确认或执行下载',
    ARCHIVED: '已经完成下载并发布到本地归档',
    ATTENTION: '解析、下载或身份检查需要处理',
    ALL: '这个来源长期保留的全部已发现画廊'
  }
  return `${descriptions[feed]}；已加载 ${itemCount} 条。`
}

function emptyCatalogViewDescription(view: ArchiveDiscoveryCatalogView) {
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
    <div className="grid gap-5 lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)]">
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
