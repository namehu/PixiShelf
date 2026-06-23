'use client'

import { useState, useCallback } from 'react'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { toast } from 'sonner'
import { exportNoSeriesArtworksAction } from '@/actions/artwork-action'
import { useMigration } from '../_hooks/use-migration'
import { MigrationDialog } from './migration-dialog'
import { confirm } from '@/components/shared/global-confirm'
import { useQueryStates, parseAsString, parseAsInteger, parseAsBoolean } from 'nuqs'
import { ProTable } from '@/components/shared/pro-table'
import { useMutation } from '@tanstack/react-query'
import { RowSelectionState } from '@tanstack/react-table'
import { BatchImportDialog } from './batch-import-dialog'
import { ArtworkUnifiedEditor } from './artwork-unified-editor'
import { ArtworkResponseDto } from '@/schemas/artwork.dto'
import { OSource } from '@/enums/ESource'
import { ArtworkManagementToolbar } from './artwork-management-toolbar'
import { ArtworkSearchPanel } from './artwork-search-panel'
import { createArtworkManagementColumns } from './artwork-management-columns'
import type { MigrationSafety } from './artwork-management-types'
import {
  buildArtworkSearchPayload,
  buildEmptyLocalSearch,
  buildInitialLocalSearch,
  buildMigrationFilters,
  MEDIA_TYPE_OPTIONS,
  normalizeAudioFilter
} from './artwork-management-utils'

export default function ArtworkManagement() {
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const [batchImportOpen, setBatchImportOpen] = useState(false)
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
  const [refreshKey, setRefreshKey] = useState(0)

  const selectedRowKeys = Object.keys(rowSelection)

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
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20)
  })

  const [isAdvancedSearchOpen, setIsAdvancedSearchOpen] = useQueryStates({
    advancedSearch: parseAsBoolean.withDefault(false)
  })

  const [localSearch, setLocalSearch] = useState(() => buildInitialLocalSearch(searchState))
  const { state: migrationState, actions: migrationActions, logger: migrationLogger } = useMigration()
  const [logOpen, setLogOpen] = useState(false)

  const refreshTable = useCallback(() => {
    setRefreshKey((prev) => prev + 1)
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
      page: 1,
      pageSize: 20
    })
  }

  const deleteMutation = useMutation(
    trpc.artwork.delete.mutationOptions({
      onSuccess: () => {
        toast.success('删除成功')
        refreshTable()
        setRowSelection({})
      }
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

  const handleOpenInfo = (item: ArtworkResponseDto) => {
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
          <div className="text-sm text-neutral-400 mt-2 space-y-2">
            <div>
              预检结果：总数 {result.total}，可迁移 {result.eligible}，缺少艺术家 {result.missingArtist}，缺少
              ExternalId {result.missingExternalId}，无图片 {result.missingImages}
            </div>
            <ul className="list-disc list-inside space-y-1 pl-2">
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
    onOpenInfo: handleOpenInfo,
    onEdit: handleEdit,
    onCopy: handleCopy,
    onOpenImageManager: handleOpenImageManager,
    onDelete: handleDelete,
    onRefresh: refreshTable
  })

  const request = useCallback(
    async (params: { pageSize: number; current: number }) => {
      const hasAudioFilter = normalizeAudioFilter(searchState.hasAudio)
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
        mediaCountMax: searchState.mediaCountMax
      })
      const { items, total } = res

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
    <div className="space-y-4 p-4">
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
        onExportNoSeries={handleExportNoSeries}
        onMigrationClick={handleMigrationClick}
        onOpenLogs={() => setLogOpen(true)}
      />

      <ProTable
        key={refreshKey}
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
        searchRender={() => (
          <ArtworkSearchPanel
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
        )}
      />

      <ArtworkUnifiedEditor
        open={!!editorConfig}
        onOpenChange={(open) => {
          if (!open) {
            setEditorConfig(null)
            setCopyInitialData(null)
          }
        }}
        artworkId={editorConfig?.id ?? null}
        initialTab={editorConfig?.tab}
        initialData={copyInitialData}
        onSuccess={refreshTable}
      />

      <MigrationDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        migrationState={migrationState}
        migrationActions={migrationActions}
        migrationLogger={migrationLogger}
      />
      <BatchImportDialog open={batchImportOpen} onOpenChange={setBatchImportOpen} onSuccess={refreshTable} />
    </div>
  )
}
