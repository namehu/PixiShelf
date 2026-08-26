'use client'

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { toast } from 'sonner'
import { exportNoSeriesArtworksAction } from '@/actions/artwork-action'
import { useMigration } from '../_hooks/use-migration'
import { MigrationDialog } from './migration-dialog'
import { confirm } from '@/components/shared/global-confirm'
import { useQueryStates, parseAsString, parseAsInteger, parseAsBoolean } from 'nuqs'
import { ProTable, type ActionType } from '@/components/shared/pro-table'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RowSelectionState, VisibilityState } from '@tanstack/react-table'
import { BatchImportDialog } from './batch-import-dialog'
import { ArtworkUnifiedEditor } from './artwork-unified-editor'
import { ArtworkPixivStatusFilterSchema, type ArtworkResponseDto } from '@/schemas/artwork.dto'
import { OSource } from '@/enums/e-source'
import { ArtworkManagementToolbar } from './artwork-management-toolbar'
import { ArtworkFilterPanel } from '@/components/artwork/artwork-filter'
import { createArtworkManagementColumns } from './artwork-management-columns'
import type { MigrationSafety } from './artwork-management-types'
import { ArtworkRowMediaPreview } from './artwork-row-media-preview'
import { AdminWorkbench } from '../../_components/admin-workbench'
import {
  buildArtworkSearchPayload,
  buildEmptyLocalSearch,
  buildInitialLocalSearch,
  buildMigrationFilters,
  MEDIA_TYPE_OPTIONS,
  normalizeAudioFilter
} from './artwork-management-utils'
import { PixivArtworkEnrichmentDialog } from './pixiv-artwork-enrichment-dialog'
import { useAdminPreferencesStore } from '@/store/admin/use-admin-preferences-store'
import { AdminImageVisibilitySwitch } from '../../_components/admin-image-visibility-switch'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PixivArtworkSyncReportDrawer } from './pixiv-artwork-sync-report-drawer'

export default function ArtworkManagement() {
  const router = useRouter()
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const queryClient = useQueryClient()
  const [batchImportOpen, setBatchImportOpen] = useState(false)
  const [pixivDialogOpen, setPixivDialogOpen] = useState(false)
  const [pixivReportArtwork, setPixivReportArtwork] = useState<ArtworkResponseDto | null>(null)
  const [editorConfig, setEditorConfig] = useState<{ id: number | null; tab: 'info' | 'media' } | null>(null)
  const [copyInitialData, setCopyInitialData] = useState<{
    title: string
    description: string
    sourceDate: string | null
    artist: { id: number; name: string } | null
    tags: { id: number; name: string }[]
  } | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isPrechecking, setIsPrechecking] = useState(false)
  const [migrationSafety, setMigrationSafety] = useState<MigrationSafety>({
    transferMode: 'move',
    verifyAfterCopy: true,
    cleanupSource: true
  })
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const tableActionRef = useRef<ActionType | undefined>(undefined)
  const loadedArtworksRef = useRef(new Map<number, ArtworkResponseDto>())
  const showArtworkPixivSync = useAdminPreferencesStore((state) => state.showArtworkPixivSync)
  const columnVisibility = useMemo<VisibilityState>(() => ({ pixivSync: showArtworkPixivSync }), [showArtworkPixivSync])

  const selectedRowKeys = Object.keys(rowSelection)
  const selectedPixivArtworks = selectedRowKeys
    .map(Number)
    .map((id) => loadedArtworksRef.current.get(id))
    .filter((artwork): artwork is ArtworkResponseDto => Boolean(artwork?.pixivEligible))

  const [searchState, setSearchState] = useQueryStates({
    id: parseAsInteger,
    title: parseAsString,
    artistName: parseAsString,
    startDate: parseAsString,
    endDate: parseAsString,
    externalId: parseAsString,
    exactMatch: parseAsBoolean.withDefault(false),
    tags: parseAsString,
    excludeTags: parseAsString,
    mediaTypes: parseAsString,
    sources: parseAsString,
    hasAudio: parseAsString.withDefault('all'),
    mediaCountMin: parseAsInteger,
    mediaCountMax: parseAsInteger,
    pixivStatus: parseAsString,
    copyMode: parseAsString,
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20)
  })

  const [editorRoute, setEditorRoute] = useQueryStates({
    edit: parseAsInteger,
    tab: parseAsString,
    returnTo: parseAsString
  })

  const [isAdvancedSearchOpen, setIsAdvancedSearchOpen] = useQueryStates({
    advancedSearch: parseAsBoolean.withDefault(false)
  })

  const [localSearch, setLocalSearch] = useState(() => buildInitialLocalSearch(searchState))
  const { state: migrationState, actions: migrationActions, logger: migrationLogger } = useMigration()
  const [logOpen, setLogOpen] = useState(false)

  useEffect(() => {
    if (!editorRoute.edit) return

    setCopyInitialData(null)
    setEditorConfig({
      id: editorRoute.edit,
      tab: editorRoute.tab === 'media' ? 'media' : 'info'
    })
  }, [editorRoute.edit, editorRoute.tab])

  const refreshTable = useCallback(() => {
    tableActionRef.current?.reload()
  }, [])

  const handleSearch = () => {
    setSearchState(buildArtworkSearchPayload(localSearch))
  }

  const handleReset = () => {
    setLocalSearch(buildEmptyLocalSearch())
    setSearchState({
      id: null,
      title: null,
      artistName: null,
      startDate: null,
      endDate: null,
      externalId: null,
      exactMatch: null,
      tags: null,
      excludeTags: null,
      mediaTypes: null,
      sources: null,
      hasAudio: null,
      mediaCountMin: null,
      mediaCountMax: null,
      pixivStatus: null,
      page: 1,
      pageSize: 20
    })
  }

  const deleteMutation = useMutation(
    trpc.artwork.delete.mutationOptions({
      onSuccess: () => {
        toast.success('删除成功')
        refreshTable()
        queryClient.invalidateQueries({ queryKey: trpc.artwork.cardList.queryKey() })
        setRowSelection({})
      }
    })
  )

  const retryPixivMutation = useMutation(
    trpc.artwork.retryPixivEnrichment.mutationOptions({
      onSuccess: () => {
        toast.success('Pixiv 作品重试任务已创建')
        refreshTable()
      },
      onError: (error) => toast.error(error.message)
    })
  )

  const handleExportNoSeries = async () => {
    try {
      setIsExporting(true)
      const res = await exportNoSeriesArtworksAction()

      if (!res.success || !res.data) {
        toast.error('导出失败: ' + (res.error || '未知错误'))
        return
      }

      const ids = res.data

      if (ids.length === 0) {
        toast.info('没有找到无系列的作品')
        return
      }

      const content = ids.join('\n')
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `no-series-artworks-${new Date().toISOString().split('T')[0]}.txt`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success(`成功导出 ${ids.length} 个作品ID`)
    } catch (_error) {
      toast.error('导出失败')
    } finally {
      setIsExporting(false)
    }
  }

  const handleDelete = (id: number) => {
    confirm({
      title: '确定删除该作品吗？',
      onConfirm: () => {
        deleteMutation.mutate(id)
      }
    })
  }

  const handleEdit = (item: ArtworkResponseDto) => {
    setCopyInitialData(null)
    setEditorConfig({ id: item.id, tab: 'info' })
  }

  const handleOpenImageManager = (item: ArtworkResponseDto) => {
    setCopyInitialData(null)
    setEditorConfig({ id: item.id, tab: 'media' })
  }

  const handleCopy = (item: ArtworkResponseDto) => {
    setCopyInitialData({
      title: item.title,
      description: item.description || '',
      sourceDate: item.sourceDate || null,
      artist: item.artist ? { id: item.artist.id, name: item.artist.name } : null,
      tags: item.tags?.map((tag) => ({ id: tag.id, name: tag.name })) || []
    })
    setEditorConfig({ id: null, tab: 'info' })
  }

  const handleMigrationClick = async () => {
    if (isPrechecking) return
    const isBatch = selectedRowKeys.length > 0
    const count = selectedRowKeys.length
    const filters = buildMigrationFilters(searchState)
    const hasFilters =
      !isBatch &&
      !!(
        filters.id ||
        filters.search ||
        filters.artistName ||
        filters.startDate ||
        filters.endDate ||
        filters.externalId ||
        filters.mediaTypes
      )

    try {
      setIsPrechecking(true)
      const precheckPayload: any = {
        targetIds: isBatch ? selectedRowKeys.map(Number) : undefined
      }
      if (hasFilters) {
        precheckPayload.id = filters.id
        precheckPayload.search = filters.search
        precheckPayload.artistName = filters.artistName
        precheckPayload.startDate = filters.startDate
        precheckPayload.endDate = filters.endDate
        precheckPayload.externalId = filters.externalId
        precheckPayload.mediaTypes = filters.mediaTypes
        precheckPayload.exactMatch = filters.exactMatch
      }

      const result = await trpcClient.migration.precheck.query(precheckPayload)

      confirm({
        title: isBatch
          ? `确认迁移选中的 ${count} 个作品？`
          : hasFilters
            ? `确认按筛选条件迁移 ${result.total} 个作品？`
            : '确认执行全量迁移？',
        description: (
          <div className="mt-2 flex flex-col gap-2 text-sm text-muted-foreground">
            <div>
              预检结果：总数 {result.total}，可迁移 {result.eligible}，缺少艺术家 {result.missingArtist}，缺少
              ExternalId {result.missingExternalId}，无图片 {result.missingImages}
            </div>
            <ul className="flex list-inside list-disc flex-col gap-1 pl-2">
              <li>迁移过程中请勿关闭浏览器窗口。</li>
              {!isBatch && !hasFilters && <li>涉及大量文件移动，可能需要较长时间。</li>}
            </ul>
          </div>
        ),
        confirmText: '确认开始',
        onConfirm: () => {
          setLogOpen(true)
          const onComplete = () => {
            refreshTable()
            setRowSelection({})
          }

          if (isBatch) {
            migrationActions.startMigration({
              targetIds: selectedRowKeys.map(Number),
              safety: migrationSafety,
              onComplete
            })
          } else {
            migrationActions.startMigration({
              filters: hasFilters ? filters : undefined,
              safety: migrationSafety,
              onComplete
            })
          }
        }
      })
    } catch (error: any) {
      toast.error(error?.message || '预检失败')
    } finally {
      setIsPrechecking(false)
    }
  }

  const columns = createArtworkManagementColumns({
    pendingReplaceCopyMode: searchState.copyMode === 'pending-replace',
    onEdit: handleEdit,
    onCopy: handleCopy,
    onOpenImageManager: handleOpenImageManager,
    onDelete: handleDelete,
    onRefresh: refreshTable,
    onRetryPixiv: (artworkId) => retryPixivMutation.mutate({ artworkId }),
    onOpenPixivReport: setPixivReportArtwork,
    retryingPixivArtworkId: retryPixivMutation.isPending ? (retryPixivMutation.variables?.artworkId ?? null) : null
  })

  const request = useCallback(
    async (params: { pageSize: number; current: number }) => {
      const hasAudioFilter = normalizeAudioFilter(searchState.hasAudio)
      const parsedPixivStatus = ArtworkPixivStatusFilterSchema.safeParse(searchState.pixivStatus)
      const res = await trpcClient.artwork.list.query({
        cursor: params.current,
        pageSize: params.pageSize,
        id: searchState.id,
        search: searchState.title,
        artistName: searchState.artistName,
        startDate: searchState.startDate,
        endDate: searchState.endDate,
        externalId: searchState.externalId,
        exactMatch: searchState.exactMatch,
        tags: searchState.tags,
        excludeTags: searchState.excludeTags,
        mediaTypes: searchState.mediaTypes,
        sources: searchState.sources,
        hasAudio: hasAudioFilter === 'all' ? undefined : hasAudioFilter,
        mediaCountMin: searchState.mediaCountMin,
        mediaCountMax: searchState.mediaCountMax,
        pixivStatus: parsedPixivStatus.success ? parsedPixivStatus.data : undefined
      })
      const { items, total } = res
      for (const artwork of items) {
        loadedArtworksRef.current.set(artwork.id, artwork as unknown as ArtworkResponseDto)
      }

      return { data: items, total, success: true }
    },
    [trpcClient, searchState]
  )

  const handlePaginationChange = (updaterOrValue: any) => {
    const newPagination =
      typeof updaterOrValue === 'function'
        ? updaterOrValue({
            pageIndex: (searchState.page || 1) - 1,
            pageSize: searchState.pageSize || 20
          })
        : updaterOrValue

    setSearchState({
      page: newPagination.pageIndex + 1,
      pageSize: newPagination.pageSize
    })
  }

  return (
    <AdminWorkbench
      title="作品管理"
      description="搜索、筛选并维护作品信息与媒体文件。"
      actions={
        <ArtworkManagementToolbar
          migrationSafety={migrationSafety}
          setMigrationSafety={setMigrationSafety}
          isExporting={isExporting}
          selectedCount={selectedRowKeys.length}
          migrationState={migrationState}
          hasMigrationLogs={migrationLogger.logs.length > 0}
          onCreate={() => {
            setCopyInitialData(null)
            setEditorConfig({ id: null, tab: 'info' })
          }}
          onBatchImport={() => setBatchImportOpen(true)}
          onBatchReplace={() => router.push('/admin/artworks/batch-replace')}
          onExportNoSeries={handleExportNoSeries}
          onMigrationClick={handleMigrationClick}
          onOpenLogs={() => setLogOpen(true)}
          pendingReplaceCopyMode={searchState.copyMode === 'pending-replace'}
          onTogglePendingReplaceCopyMode={() =>
            setSearchState({
              copyMode: searchState.copyMode === 'pending-replace' ? null : 'pending-replace'
            })
          }
          selectedPixivCount={selectedPixivArtworks.length}
          onPixivSync={() => setPixivDialogOpen(true)}
        />
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        <ProTable
          actionRef={tableActionRef}
          columns={columns}
          request={request as any}
          defaultPageSize={20}
          pagination={{
            pageIndex: (searchState.page || 1) - 1,
            pageSize: searchState.pageSize || 20
          }}
          onPaginationChange={handlePaginationChange}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          columnVisibility={columnVisibility}
          toolBarRender={() => (
            <AdminImageVisibilitySwitch
              id="artwork-pixiv-sync-column-visibility"
              label="显示 Pixiv 同步状态"
              preference="artwork-pixiv-sync"
            />
          )}
          renderExpandedRow={(artwork) => (
            <ArtworkRowMediaPreview artworkId={(artwork as ArtworkResponseDto).id} onSuccess={refreshTable} />
          )}
          searchRender={() => (
            <div className="grid w-full gap-3">
              <div className="flex justify-end">
                <Select
                  value={searchState.pixivStatus || 'all'}
                  onValueChange={(value) => {
                    setRowSelection({})
                    setSearchState({ pixivStatus: value === 'all' ? null : value, page: 1 })
                  }}
                >
                  <SelectTrigger className="h-8 w-[180px]" aria-label="筛选 Pixiv 同步状态">
                    <SelectValue placeholder="Pixiv 同步状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">全部同步状态</SelectItem>
                      <SelectItem value="NO_IDENTITY">无 Pixiv 身份</SelectItem>
                      <SelectItem value="UNCHECKED">待检查</SelectItem>
                      <SelectItem value="CHECKED">已检查</SelectItem>
                      <SelectItem value="SUCCESS">成功</SelectItem>
                      <SelectItem value="PARTIAL">部分成功</SelectItem>
                      <SelectItem value="NO_DATA">无数据</SelectItem>
                      <SelectItem value="FAILED">失败</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <ArtworkFilterPanel
                inlineLabels
                localSearch={localSearch}
                setLocalSearch={setLocalSearch}
                advancedSearchOpen={isAdvancedSearchOpen.advancedSearch}
                onAdvancedSearchOpenChange={(advancedSearch) => setIsAdvancedSearchOpen({ advancedSearch })}
                mediaTypeOptions={MEDIA_TYPE_OPTIONS}
                sourceOptions={OSource}
                onSearchTags={async (query) => {
                  const res = await trpcClient.tag.list.query({ query, pageSize: 20 })
                  return (res as any).items.map((tag: any) => ({
                    label: tag.name_zh ? `${tag.name} (${tag.name_zh})` : tag.name,
                    value: tag.name
                  }))
                }}
                onSearch={handleSearch}
                onReset={handleReset}
              />
            </div>
          )}
        />

        <ArtworkUnifiedEditor
          open={!!editorConfig}
          onOpenChange={(open) => {
            if (!open) {
              setEditorConfig(null)
              setCopyInitialData(null)
              void setEditorRoute({ edit: null, tab: null, returnTo: null })
            }
          }}
          artworkId={editorConfig?.id ?? null}
          initialTab={editorConfig?.tab}
          initialData={copyInitialData}
          onSuccess={refreshTable}
          returnTo={editorConfig?.id === editorRoute.edit ? editorRoute.returnTo : null}
        />

        <MigrationDialog
          open={logOpen}
          onOpenChange={setLogOpen}
          migrationState={migrationState}
          migrationActions={migrationActions}
          migrationLogger={migrationLogger}
        />
        <BatchImportDialog open={batchImportOpen} onOpenChange={setBatchImportOpen} onSuccess={refreshTable} />
        <PixivArtworkEnrichmentDialog
          open={pixivDialogOpen}
          onOpenChange={setPixivDialogOpen}
          onStatusChanged={() => {
            refreshTable()
            setRowSelection({})
          }}
          selectedArtworks={selectedPixivArtworks.map((artwork) => ({
            id: artwork.id,
            title: artwork.title,
            checked: artwork.pixivSync?.status != null
          }))}
        />
        <PixivArtworkSyncReportDrawer
          artwork={pixivReportArtwork}
          onOpenChange={(open) => {
            if (!open) setPixivReportArtwork(null)
          }}
        />
      </div>
    </AdminWorkbench>
  )
}
