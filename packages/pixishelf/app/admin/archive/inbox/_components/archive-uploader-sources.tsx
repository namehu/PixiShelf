'use client'

import { ScanResults } from './archive-discovery-scan-results'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { ArrowLeftIcon, BanIcon, InfoIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { AppRouter } from '@/server'
import { useTRPC } from '@/lib/trpc'
import { useMediaQuery } from '@/hooks/use-media-query'
import { AdminSection, AdminSectionHeader } from '@/app/admin/_components/admin-workbench'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ArchiveDiscoveryIgnoreDialog, type DiscoveryIgnoreSelection } from './archive-discovery-ignore-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useAdminPreferencesStore } from '@/store/admin/use-admin-preferences-store'
import { ArchiveDiscoveryBulkBar } from './archive-discovery-bulk-bar'
import { DiscoveryCreatorDialog, type DiscoveryCreatorDialogState } from './discovery-creator-dialog'
import { DiscoveryPendingCreators } from './discovery-pending-creators'
import { ArchiveDiscoveryDeleteDialog } from './archive-discovery-delete-dialog'
import { ArchiveDiscoveryDetailHeader } from './archive-discovery-detail-header'
import { IgnoredResults } from './archive-discovery-ignored-results'
import { type ArchiveDiscoveryListPosition } from './archive-discovery-result-list'
import { ArchiveDiscoveryResultsToolbar, type ArchiveDiscoveryCatalogView } from './archive-discovery-results-toolbar'
import { DEFAULT_ARCHIVE_INTAKE_OPTIONS } from './archive-intake-options'
import { ArchiveSearchSourceDialog, type ArchiveSearchDialogState } from './archive-search-source-dialog'
import { copyArchiveUploaderUid } from './archive-uploader-clipboard'
import { ArchiveUploaderCreateSourceDialog } from './archive-uploader-create-source-dialog'
import {
  ArchiveUploaderGalleryPreviewDialog,
  type ArchiveUploaderPreviewItem,
  ArchiveUploaderResultViewToggle
} from './archive-uploader-result-visuals'
import { ArchiveDiscoveryBatchSources } from './archive-discovery-batch-sources'
import { ArchiveUploaderUidConflictAlert } from './archive-uploader-uid-conflict-alert'
import { ArchiveUploaderUidDialog } from './archive-uploader-uid-dialog'
import { archiveUploaderDetailPollingInterval, isActiveArchiveUploaderRunStatus } from './archive-uploader-view-state'

type RouterOutputs = inferRouterOutputs<AppRouter>
type ScanItem = RouterOutputs['archiveSearch']['listItems']['items'][number]
type ScanItemsPage = RouterOutputs['archiveSearch']['listItems']
type IgnoredItemsPage = RouterOutputs['archiveSearch']['listIgnoredItems']
type NavigationHistory = 'push' | 'replace'

const SCAN_RESULT_PAGE_SIZE = 50
const MAX_SELECTED_ITEMS = 100
const isSubmittableItem = (item: ScanItem) => item.actionable || item.recoverable

export function ArchiveUploaderSources({
  active,
  locatedSourceId,
  ignored,
  pendingCreators = false,
  onNavigatePendingCreators,
  onNavigateSource,
  onNavigateSourceList,
  onNavigateIgnored,
  onNavigateInboxItem
}: {
  active: boolean
  locatedSourceId: string | null
  ignored: boolean
  pendingCreators?: boolean
  onNavigatePendingCreators?: () => void
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
  const [ignoreSelection, setIgnoreSelection] = useState<DiscoveryIgnoreSelection | null>(null)
  const ignoreSubmitting = useRef(false)
  const [creatorDialog, setCreatorDialog] = useState<DiscoveryCreatorDialogState | null>(null)
  const [unboundOnly, setUnboundOnly] = useState(false)
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
    const view = pendingCreators ? 'pending-creators' : ignored ? 'ignored' : (locatedSourceId ?? 'list')
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
  }, [active, ignored, pendingCreators, isDesktop, layoutReady, locatedSourceId, sourcesQuery.isPending])

  useEffect(() => {
    if (!selectedSourceId) return
    const previousSourceId = activeDraftSourceIdRef.current
    if (previousSourceId && previousSourceId !== selectedSourceId) {
      setSelectedItemIds(new Set())
      setIntakeOptions(DEFAULT_ARCHIVE_INTAKE_OPTIONS)
      setResultFeed('ACTIONABLE')
      setUnboundOnly(false)
      setCreatorDialog(null)
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
      { sourceId: selectedSourceId ?? 'unselected', view: resultFeed, limit: SCAN_RESULT_PAGE_SIZE, unboundOnly },
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
      const available = new Set(items.map(({ id }) => id))
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
      onSettled: () => {
        ignoreSubmitting.current = false
      },
      onSuccess: async (result, variables) => {
        queryClient.setQueriesData<InfiniteData<ScanItemsPage>>(
          { queryKey: trpc.archiveSearch.listItems.infiniteQueryKey() },
          (current) => removeInfiniteItems(current, variables.itemIds)
        )
        setSelectedItemIds(new Set())
        setIgnoreSelection(null)
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
  const bulkSelectableItems = items.slice(0, MAX_SELECTED_ITEMS)
  const selectedItems = items.filter((item) => selectedItemIds.has(item.id))
  const selectedSubmittable = submittableItems.filter((item) => selectedItemIds.has(item.id))
  const selectedIgnorable = selectedItems.filter((item) => item.actionable)
  const openCreators = (mode: 'bind' | 'cancel') => {
    if (!selectedSourceId) return
    const pending = [
      ...new Map(selectedItems.flatMap((item) => item.pendingCreators ?? []).map((row) => [row.id, row])).values()
    ]
    setCreatorDialog({
      mode,
      sourceId: selectedSourceId,
      itemIds: [...selectedItemIds],
      immediateCount: selectedItems.filter((item) => item.artworkId !== null).length,
      initialCreators: mode === 'cancel' ? pending : []
    })
  }
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
  const mobileDetail = layoutReady && !isDesktop && (ignored || pendingCreators || Boolean(locatedSourceId))

  if (!active) return null

  const globalHeader = !mobileDetail ? (
    <>
      <AdminSectionHeader
        title="发现来源"
        description="保存上传者或标题关键词条件；手动扫描并勾选结果，再按所选模式加入收件箱。"
        actions={
          <>
            {onNavigatePendingCreators ? (
              <Button variant="outline" onClick={onNavigatePendingCreators}>
                待生效绑定
              </Button>
            ) : null}
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
      {!ignored && !pendingCreators ? (
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

  const sourceList = (
    <ArchiveDiscoveryBatchSources
      allSources={allSources}
      sources={sources}
      selectedSourceId={selectedSourceId}
      onCopyUid={(uploaderUid) => void copyArchiveUploaderUid(uploaderUid)}
      onSelect={enterSource}
    />
  )

  const source = detail?.source
  const resultPositionKey = selectedSourceId ? `${selectedSourceId}:${resultFeed}:${unboundOnly}` : 'unselected'
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
              ACTIONABLE: (itemsQuery.data?.pages[0]?.counts ?? source.catalogCounts).actionable,
              PROCESSING: (itemsQuery.data?.pages[0]?.counts ?? source.catalogCounts).processing,
              ARCHIVED: (itemsQuery.data?.pages[0]?.counts ?? source.catalogCounts).archived,
              ATTENTION: (itemsQuery.data?.pages[0]?.counts ?? source.catalogCounts).attention,
              ALL: (itemsQuery.data?.pages[0]?.counts ?? source.catalogCounts).total
            }}
            description={resultFeedDescription(resultFeed, items.length)}
            resultView={resultView}
            onViewChange={setResultFeed}
            onResultViewChange={setResultView}
            intakeOptions={intakeOptions}
            onIntakeOptionsChange={setIntakeOptions}
            disabled={mutationPending}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() =>
                setCreatorDialog({
                  mode: 'defaults',
                  sourceId: source.id,
                  itemIds: [],
                  immediateCount: 0,
                  initialCreators: source.defaultCreators ?? []
                })
              }
            >
              固定艺术家（{source.defaultCreators?.length ?? 0}）
            </Button>
            <PrivacySensitiveText>{source.defaultCreators?.map((row) => row.name).join('、')}</PrivacySensitiveText>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={unboundOnly}
                onCheckedChange={(checked) => {
                  setUnboundOnly(checked === true)
                  setSelectedItemIds(new Set())
                }}
              />
              仅看未绑定
            </label>
          </div>
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
            onIgnore={(itemId) =>
              setIgnoreSelection({
                sourceId: source.id,
                items: items.filter((item) => item.id === itemId).map(({ id, title }) => ({ id, title }))
              })
            }
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
            ignoreDisabled={selectedIgnorable.length === 0}
            ignoreCount={selectedIgnorable.length}
            addCount={selectedSubmittable.length}
            onBind={() => openCreators('bind')}
            onCancelPending={
              selectedItems.some((item) => item.pendingCreators?.length) ? () => openCreators('cancel') : undefined
            }
            addLabel={resultFeed === 'ATTENTION' ? '重新加入收件箱' : '加入收件箱'}
            onClear={() => setSelectedItemIds(new Set())}
            onIgnore={() =>
              setIgnoreSelection({
                sourceId: source.id,
                items: selectedIgnorable.map(({ id, title }) => ({ id, title }))
              })
            }
            onAdd={() =>
              submissionAttemptMutation.mutate({
                sourceId: source.id,
                itemIds: selectedSubmittable.map((item) => item.id),
                ...intakeOptions
              })
            }
          />
        </>
      )}
    </AdminSection>
  )

  return (
    <div className="flex min-w-0 flex-col gap-6 pt-4">
      {globalHeader}
      <ArchiveDiscoveryIgnoreDialog
        selection={ignoreSelection}
        pending={ignoreMutation.isPending}
        onClose={() => {
          if (!ignoreSubmitting.current) setIgnoreSelection(null)
        }}
        onConfirm={() => {
          if (!ignoreSelection || ignoreSubmitting.current) return
          ignoreSubmitting.current = true
          ignoreMutation.mutate({
            sourceId: ignoreSelection.sourceId,
            itemIds: ignoreSelection.items.map(({ id }) => id)
          })
        }}
      />
      {creatorDialog ? (
        <DiscoveryCreatorDialog
          key={`${creatorDialog.sourceId}:${creatorDialog.mode}`}
          state={creatorDialog}
          onClose={() => setCreatorDialog(null)}
          onSaved={refresh}
        />
      ) : null}
      {pendingCreators ? (
        <DiscoveryPendingCreators onBack={() => onNavigateSourceList('push')} />
      ) : ignored ? (
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
        sources={allSources}
        state={searchDialog}
        onClose={() => setSearchDialog(null)}
        onSaved={async (sourceId) => {
          setSourceFilter('ALL')
          await refresh()
          enterSource(sourceId)
        }}
      />
      <ArchiveUploaderCreateSourceDialog
        sources={allSources}
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
