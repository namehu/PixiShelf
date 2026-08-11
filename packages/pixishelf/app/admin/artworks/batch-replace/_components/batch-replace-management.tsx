'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FolderSearch,
  GripVertical,
  ImageIcon,
  Loader2,
  Play,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Video,
  XCircle
} from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { confirm } from '@/components/shared/global-confirm'
import { combinationApiResource } from '@/utils/combination-static'
import { formatFileSize } from '@/utils/media'
import {
  PENDING_REPLACE_STALE_JOB_MS,
  type PendingReplaceMediaSnapshot
} from '@/schemas/pending-replace.dto'
import type { BatchItemView, BatchView } from './batch-replace-types'
import { PendingReplacePairingWorkspace } from './pending-replace-pairing-workspace'

const ACTIVE_JOB_STATUSES = new Set(['PENDING', 'RUNNING', 'CANCELLING'])
const SUCCESS_ITEM_STATUSES = new Set(['SUCCESS', 'BACKUP_CLEANED'])

export default function BatchReplaceManagement() {
  const trpc = useTRPC()
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set())

  const statusQuery = useQuery(
    trpc.pendingReplace.status.queryOptions({}, {
      refetchInterval: (query) => {
        const batch = query.state.data as unknown as BatchView | null | undefined
        return batch?.systemJob?.status && ACTIVE_JOB_STATUSES.has(batch.systemJob.status) ? 1500 : 5000
      }
    })
  )
  const batch = statusQuery.data as unknown as BatchView | null | undefined
  const previewMutation = useMutation(
    trpc.pendingReplace.preview.mutationOptions({
      onSuccess: async () => {
        toast.success('待替换目录扫描完成')
        await statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const startMutation = useMutation(
    trpc.pendingReplace.start.mutationOptions({
      onSuccess: async () => {
        toast.success('批量替换任务已启动')
        await statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const cancelMutation = useMutation(
    trpc.pendingReplace.cancel.mutationOptions({
      onSuccess: async () => statusQuery.refetch(),
      onError: (error) => toast.error(error.message)
    })
  )
  const restoreMutation = useMutation(
    trpc.pendingReplace.restore.mutationOptions({
      onSuccess: async () => {
        toast.success('旧媒体已恢复，新媒体已退回待处理目录')
        await statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const recoverMutation = useMutation(
    trpc.pendingReplace.recover.mutationOptions({
      onSuccess: async (result) => {
        toast.success(`中断现场已回滚，处理 ${result.recoveredItems} 个未完成项目`)
        await statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const cleanupMutation = useMutation(
    trpc.pendingReplace.cleanupBackups.mutationOptions({
      onSuccess: async () => {
        toast.success('本批次旧媒体备份已清理')
        await statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const reorderMutation = useMutation(
    trpc.pendingReplace.reorder.mutationOptions({
      onSuccess: async () => {
        toast.success('媒体顺序已保存')
        await statusQuery.refetch()
      },
      onError: (error) => toast.error(error.message)
    })
  )

  useEffect(() => {
    if (!batch || batch.status !== 'PREVIEWED') return
    setSelectedItemIds(new Set(batch.items.filter((item) => item.status === 'READY').map((item) => item.id)))
  }, [batch?.id, batch?.status, batch?.readyItems])

  useEffect(() => {
    if (!batch || batch.status === 'PREVIEWED') return
    const selectableIds = new Set(
      batch.items
        .filter((item) => ['READY', 'FAILED', 'EXCLUDED'].includes(item.status))
        .map((item) => item.id)
    )
    setSelectedItemIds((current) => new Set([...current].filter((itemId) => selectableIds.has(itemId))))
  }, [batch?.id, batch?.status, batch?.readyItems, batch?.failedItems, batch?.excludedItems])

  const isRunning = Boolean(batch?.systemJob && ACTIVE_JOB_STATUSES.has(batch.systemJob.status))
  const jobHeartbeatAt = batch?.systemJob?.heartbeatAt ?? batch?.systemJob?.updatedAt
  const isRecoverable = Boolean(
    isRunning &&
    jobHeartbeatAt &&
    Date.now() - new Date(jobHeartbeatAt).getTime() >= PENDING_REPLACE_STALE_JOB_MS
  )
  const selectedCount = selectedItemIds.size
  const failedItemIds = batch?.items.filter((item) => item.status === 'FAILED').map((item) => item.id) ?? []

  const toggleSelected = (itemId: string, checked: boolean) => {
    setSelectedItemIds((current) => {
      const next = new Set(current)
      if (checked) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }

  const toggleExpanded = (itemId: string) => {
    setExpandedItemIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const start = (itemIds: string[]) => {
    if (!batch) return
    startMutation.mutate({ batchId: batch.id, itemIds })
  }

  return (
    <div className="w-full p-4 md:p-6">
      <div className="space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-1">
            <Button asChild variant="ghost" size="sm" className="-ml-3 mb-1">
              <Link href="/admin/artworks">
                <ArrowLeft className="mr-1 h-4 w-4" /> 返回作品管理
              </Link>
            </Button>
            <h1 className="text-2xl font-bold tracking-tight">批量替换作品媒体</h1>
            <p className="text-sm text-muted-foreground">
              扫描 <code className="rounded bg-muted px-1.5 py-0.5">scanPath/pending-replaces</code>；原始目录名可直接配对，
              以 <code className="rounded bg-muted px-1.5 py-0.5">__ext-&#123;externalId&#125;</code> 结尾时仍会自动匹配。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => previewMutation.mutate()}
              disabled={isRunning || previewMutation.isPending}
            >
              {previewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderSearch className="mr-2 h-4 w-4" />}
              扫描预检
            </Button>
            {isRunning ? (
              <>
                {isRecoverable && (
                  <Button
                    variant="outline"
                    disabled={recoverMutation.isPending}
                    onClick={() =>
                      batch &&
                      confirm({
                        title: '确认回收中断的替换任务？',
                        description: '仅在服务已经重启或任务确定停止时使用。未完成项目会回滚，已成功项目保持不变。',
                        confirmText: '确认回收',
                        onConfirm: () => recoverMutation.mutate({ batchId: batch.id })
                      })
                    }
                  >
                    {recoverMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                    恢复中断现场
                  </Button>
                )}
                <Button
                  variant="destructive"
                  onClick={() => batch && cancelMutation.mutate({ batchId: batch.id })}
                  disabled={batch?.systemJob?.status === 'CANCELLING'}
                >
                  <Square className="mr-2 h-4 w-4" />
                  {batch?.systemJob?.status === 'CANCELLING' ? '正在安全停止' : '取消任务'}
                </Button>
              </>
            ) : (
              <Button onClick={() => start([...selectedItemIds])} disabled={!batch || selectedCount === 0 || startMutation.isPending}>
                {startMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                确认替换 ({selectedCount})
              </Button>
            )}
          </div>
        </div>

        {batch && <BatchSummary batch={batch} />}

        {batch?.systemJob && (
          <Card>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between text-sm">
                <span>{batch.systemJob.message || batch.systemJob.status}</span>
                <span>{batch.systemJob.progress}%</span>
              </div>
              <Progress value={batch.systemJob.progress} />
              {batch.systemJob.error && <p className="text-sm text-destructive">{batch.systemJob.error}</p>}
            </CardContent>
          </Card>
        )}

        {batch?.status === 'PREVIEWED' && (
          <PendingReplacePairingWorkspace
            batch={batch}
            disabled={isRunning}
            onBound={() => statusQuery.refetch()}
          />
        )}

        {batch?.items.length ? (
          <Card>
            <CardHeader className="border-b">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-lg">预检项目</CardTitle>
                  <CardDescription>展开后才加载新旧媒体缩略图；错误项必须排除。</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {failedItemIds.length > 0 && !isRunning && (
                    <Button variant="outline" size="sm" onClick={() => start(failedItemIds)}>
                      <RotateCcw className="mr-2 h-4 w-4" /> 仅重试失败项
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => downloadReport(batch, 'json')}>
                    <Download className="mr-2 h-4 w-4" /> JSON
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadReport(batch, 'csv')}>
                    <Download className="mr-2 h-4 w-4" /> CSV
                  </Button>
                  {batch.backupBytes > 0 && !isRunning && (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={cleanupMutation.isPending}
                      onClick={() =>
                        confirm({
                          title: '确认清理本批次旧媒体备份？',
                          description: '清理后将无法恢复旧媒体。',
                          confirmText: '确认清理',
                          onConfirm: () => cleanupMutation.mutate({ batchId: batch.id })
                        })
                      }
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> 清理备份
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {batch.items.map((item) => {
                  const expanded = expandedItemIds.has(item.id)
                  const selectable = ['READY', 'FAILED', 'EXCLUDED'].includes(item.status) && !isRunning
                  return (
                    <div key={item.id}>
                      <div className="flex items-start gap-3 p-4 hover:bg-muted/30">
                        <Checkbox
                          checked={selectedItemIds.has(item.id)}
                          disabled={!selectable}
                          onCheckedChange={(value) => toggleSelected(item.id, Boolean(value))}
                          className="mt-1"
                        />
                        <button type="button" onClick={() => toggleExpanded(item.id)} className="mt-0.5 text-muted-foreground">
                          {expanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium">{item.sourceDirectoryName}</span>
                            <ItemStatusBadge item={item} />
                            {item.warnings.length > 0 && <Badge variant="outline">{item.warnings.length} 条警告</Badge>}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            → {item.artworkTitle || '未匹配作品'} {item.externalId ? `(${item.externalId})` : ''} · 旧{' '}
                            {item.oldMediaSnapshot.length} / 新 {item.newMediaSnapshot.length}
                          </div>
                          {item.error && <p className="mt-1 whitespace-pre-wrap text-sm text-destructive">{item.error}</p>}
                        </div>
                        {item.status === 'SUCCESS' && item.backupDirectory && !isRunning && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={restoreMutation.isPending}
                            onClick={() =>
                              confirm({
                                title: `恢复 ${item.artworkTitle || item.externalId} 的旧媒体？`,
                                description: '当前新媒体将退回 pending-replaces，旧媒体和数据库记录会恢复。',
                                confirmText: '确认恢复',
                                onConfirm: () => restoreMutation.mutate({ itemId: item.id })
                              })
                            }
                          >
                            <RotateCcw className="mr-2 h-4 w-4" /> 恢复旧媒体
                          </Button>
                        )}
                      </div>
                      {expanded && (
                        <ExpandedItem
                          item={item}
                          canReorder={batch.status === 'PREVIEWED' && item.status === 'READY'}
                          onSaveOrder={(orderedSourceNames) => reorderMutation.mutate({ itemId: item.id, orderedSourceNames })}
                          savingOrder={reorderMutation.isPending}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <FolderSearch className="mb-3 h-10 w-10 opacity-40" />
              <p>点击“扫描预检”读取待替换目录。</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function BatchSummary({ batch }: { batch: BatchView }) {
  const stats = [
    ['目录', batch.totalItems],
    ['可执行', batch.readyItems],
    ['无效', batch.invalidItems],
    ['成功', batch.succeededItems],
    ['失败', batch.failedItems],
    ['已恢复', batch.restoredItems]
  ]
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      {stats.map(([label, value]) => (
        <Card key={label}>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
          </CardContent>
        </Card>
      ))}
      {batch.backupBytes > 0 && (
        <p className="col-span-full text-sm text-muted-foreground">旧媒体备份占用：{formatFileSize(batch.backupBytes)}</p>
      )}
    </div>
  )
}

function ExpandedItem({
  item,
  canReorder,
  onSaveOrder,
  savingOrder
}: {
  item: BatchItemView
  canReorder: boolean
  onSaveOrder: (names: string[]) => void
  savingOrder: boolean
}) {
  return (
    <div className="border-t bg-muted/10 p-4">
      <div className="grid gap-5 xl:grid-cols-2">
        <MediaPreviewGroup title="替换前（前 5 项）" item={item} media={item.oldMediaSnapshot.slice(0, 5)} side="old" />
        <MediaPreviewGroup title="替换后（前 5 项）" item={item} media={item.newMediaSnapshot.slice(0, 5)} side="new" />
      </div>
      {item.warnings.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {item.warnings.map((warning) => <div key={warning}>{warning}</div>)}
        </div>
      )}
      {canReorder && item.newMediaSnapshot.length > 1 && (
        <MediaOrderEditor media={item.newMediaSnapshot} onSave={onSaveOrder} saving={savingOrder} />
      )}
    </div>
  )
}

function MediaPreviewGroup({
  title,
  item,
  media,
  side
}: {
  title: string
  item: BatchItemView
  media: PendingReplaceMediaSnapshot[]
  side: 'old' | 'new'
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {media.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">无媒体</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {media.map((entry) => <MediaPreviewCard key={`${side}-${entry.path}-${entry.order}`} item={item} media={entry} side={side} />)}
        </div>
      )}
    </div>
  )
}

function MediaPreviewCard({ item, media, side }: { item: BatchItemView; media: PendingReplaceMediaSnapshot; side: 'old' | 'new' }) {
  const extension = media.targetName.split('.').pop()?.toLowerCase()
  const isVideo = ['mp4', 'webm', 'mkv', 'mov', 'avi'].includes(extension || '')
  const path = resolvePreviewPath(item, media, side)
  return (
    <div className="min-w-0 overflow-hidden rounded-md border bg-background">
      <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted">
        {isVideo ? (
          <Video className="h-8 w-8 text-muted-foreground" />
        ) : path ? (
          <img src={combinationApiResource(path)} alt={media.sourceName} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        )}
      </div>
      <div className="space-y-1 p-2 text-[11px]">
        <div className="truncate" title={media.sourceName}>{media.sourceName}</div>
        {side === 'new' && <div className="truncate text-muted-foreground" title={media.targetName}>→ {media.targetName}</div>}
        <div className="text-muted-foreground">{media.width}×{media.height} · {formatFileSize(media.size)}</div>
      </div>
    </div>
  )
}

function MediaOrderEditor({
  media,
  onSave,
  saving
}: {
  media: PendingReplaceMediaSnapshot[]
  onSave: (names: string[]) => void
  saving: boolean
}) {
  const initialOrder = useMemo(() => [...media].sort((a, b) => a.order - b.order).map((item) => item.sourceName), [media])
  const [names, setNames] = useState(initialOrder)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  useEffect(() => setNames(initialOrder), [initialOrder])
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    setNames((current) => arrayMove(current, current.indexOf(String(active.id)), current.indexOf(String(over.id))))
  }
  return (
    <div className="mt-5 rounded-md border bg-background p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">完整媒体顺序</h3>
          <p className="text-xs text-muted-foreground">拖动文件名调整最终 p0、p1… 顺序。</p>
        </div>
        <Button size="sm" variant="outline" disabled={saving || names.every((name, index) => name === initialOrder[index])} onClick={() => onSave(names)}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} 保存顺序
        </Button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={names} strategy={verticalListSortingStrategy}>
          <div className="max-h-72 space-y-1 overflow-auto">
            {names.map((name, index) => <SortableMediaRow key={name} id={name} order={index} />)}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableMediaRow({ id, order }: { id: string; order: number }) {
  const sortable = useSortable({ id })
  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className="flex items-center gap-2 rounded border bg-background px-2 py-1.5 text-xs"
    >
      <button type="button" {...sortable.attributes} {...sortable.listeners} className="cursor-grab text-muted-foreground">
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-8 font-mono text-muted-foreground">p{order}</span>
      <span className="truncate">{id}</span>
    </div>
  )
}

function ItemStatusBadge({ item }: { item: BatchItemView }) {
  const { status } = item
  if (['SUCCESS', 'BACKUP_CLEANED'].includes(status)) return <Badge className="bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" />成功</Badge>
  if (status === 'RESTORED') return <Badge variant="secondary"><RotateCcw className="mr-1 h-3 w-3" />已恢复</Badge>
  if (status === 'INVALID' && !item.artworkId && item.newMediaSnapshot.length > 0) return <Badge className="bg-amber-500">待配对</Badge>
  if (['INVALID', 'FAILED'].includes(status)) return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />{status === 'INVALID' ? '无效' : '失败'}</Badge>
  if (status === 'EXCLUDED') return <Badge variant="outline">已排除</Badge>
  if (['STAGING', 'BACKING_UP', 'SWAPPING', 'COMMITTING', 'ROLLING_BACK', 'RESTORING', 'RESTORE_SWAPPING'].includes(status)) return <Badge><Loader2 className="mr-1 h-3 w-3 animate-spin" />处理中</Badge>
  return <Badge variant="secondary">待执行</Badge>
}

function resolvePreviewPath(item: BatchItemView, media: PendingReplaceMediaSnapshot, side: 'old' | 'new') {
  if (side === 'old') {
    return item.status === 'SUCCESS' && item.backupDirectory
      ? joinStoredPath(item.backupDirectory, media.sourceName)
      : media.path
  }
  if (SUCCESS_ITEM_STATUSES.has(item.status) && item.targetDirectory) {
    return joinStoredPath(item.targetDirectory, media.targetName)
  }
  return media.path
}

function joinStoredPath(directory: string, name: string) {
  return `${directory.replace(/\/$/, '')}/${name}`
}

function downloadReport(batch: BatchView, format: 'json' | 'csv') {
  const content = format === 'json'
    ? JSON.stringify(batch, null, 2)
    : [
        ['externalId', 'artworkId', 'title', 'sourceDirectory', 'status', 'oldMedia', 'newMedia', 'error'],
        ...batch.items.map((item) => [
          item.externalId ?? '',
          item.artworkId ?? '',
          item.artworkTitle ?? '',
          item.sourceDirectory,
          item.status,
          item.oldMediaSnapshot.length,
          item.newMediaSnapshot.length,
          item.error ?? ''
        ])
      ].map((row) => row.map(csvCell).join(',')).join('\n')
  const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `pending-replace-${batch.id}.${format}`
  anchor.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: unknown) {
  return `"${String(value).replace(/"/g, '""')}"`
}
