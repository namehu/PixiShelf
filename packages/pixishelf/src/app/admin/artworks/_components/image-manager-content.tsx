'use client'

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useTRPCClient } from '@/lib/trpc'
import { RefreshCw, LayoutGrid, List as ListIcon, ZoomIn, FileUp, Trash2, Plus, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProTable, ProColumnDef } from '@/components/shared/pro-table'
import { formatFileSize } from '@/utils/media'
import { combinationApiResource } from '@/utils/combinationStatic'
import { ProDialog } from '@/components/shared/pro-dialog'
import { ImageReplaceDialog } from './image-replace-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useChunkUpload } from '../_hooks/use-chunk-upload'
import { toast } from 'sonner'
import { useDragDropStore } from '../_store/drag-drop-store'
import { useDragImages } from '../_hooks/use-drag-images'
import { LazyImage } from './lazy-image'
import { HoverPreview } from './hover-preview'
import { ImagePreviewDialog } from './image-preview-dialog'
import { AddImageDialog } from './add-image-dialog'
import { appendCacheKey } from './utils'
import { ImageListItem } from './types'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { useRecentTags } from '@/store/admin/useRecentTags'
import { RecentTagsList } from './recent-tags-list'

interface ImageManagerContentProps {
  data: any
  onSuccess?: () => void
}

export function ImageManagerContent({ data, onSuccess }: ImageManagerContentProps) {
  const artwork = data || {}
  const artworkId = artwork.id
  const imageList = (artwork.images || []) as unknown as ImageListItem[]

  const trpcClient = useTRPCClient()
  const { addTag } = useRecentTags()
  const [refreshKey, setRefreshKey] = useState(0)
  const [isSavingTags, setIsSavingTags] = useState(false)
  const [selectedTagOptions, setSelectedTagOptions] = useState<Option[]>([])
  const saveTagsQueueRef = useRef(Promise.resolve())

  useEffect(() => {
    const nextOptions = (artwork.tags || []).map((t: { id: number; name: string }) => ({
      value: t.id.toString(),
      label: t.name
    }))
    setSelectedTagOptions(nextOptions)
  }, [artwork.id, artwork.tags])

  // View State
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [showReplaceDialog, setShowReplaceDialog] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)

  // Add State
  const [defaultAddOrder, setDefaultAddOrder] = useState(0)
  const [isAdding, setIsAdding] = useState(false)
  const [addProgress, setAddProgress] = useState(0)
  const { uploadSingleFile } = useChunkUpload()
  const [addInitialFile, setAddInitialFile] = useState<File | null>(null)

  const handleAddSubmit = async (file: File, order: number) => {
    if (!artworkId) return

    try {
      setIsAdding(true)
      setAddProgress(0)

      const { targetDir, targetRelDir } = await trpcClient.artwork.getUploadPath.query(artworkId)
      const ext = file.name.split('.').pop() || ''
      const fileName = `${artwork.externalId}_p${order}.${ext}`

      const meta = await uploadSingleFile(file, fileName, targetDir, targetRelDir, (progress) => {
        setAddProgress(progress)
      })

      if (!meta) {
        throw new Error('Upload failed: No metadata returned')
      }

      await trpcClient.artwork.addImage.mutate({
        artworkId,
        file: {
          fileName: meta.fileName,
          order: order,
          width: meta.width,
          height: meta.height,
          size: meta.size,
          path: meta.path
        }
      })

      toast.success('图片添加成功')
      setShowAddDialog(false)
      setRefreshKey((k) => k + 1)
      onSuccess?.()
    } catch (error: any) {
      console.error('Add image failed:', error)
      toast.error(`添加失败: ${error.message}`)
    } finally {
      setIsAdding(false)
    }
  }

  // Delete State
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const [deletePhysical, setDeletePhysical] = useState(false)

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await trpcClient.artwork.deleteImage.mutate({
        id: deleteTarget,
        deleteFile: deletePhysical
      })
      toast.success('删除成功')
      setDeleteTarget(null)
      setDeletePhysical(false)
      setRefreshKey((k) => k + 1)
      onSuccess?.()
    } catch (error) {
      toast.error('删除失败')
      console.error(error)
    }
  }

  // --- Hover Preview Logic ---
  const [hoverImage, setHoverImage] = useState<string | null>(null)
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 })
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)

  const handleMouseEnter = useCallback((path: string, e: React.MouseEvent) => {
    const { clientX, clientY } = e
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      setHoverImage(path)
      setHoverPos({ x: clientX, y: clientY })
    }, 150)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    setHoverImage(null)
  }, [])

  // --- Download Image Logic ---
  const handleDownload = useCallback(async (path: string) => {
    try {
      const url = combinationApiResource(path)
      if (!url) throw new Error('无效的图片路径')

      const fileName = path.split('/').pop() || 'image'

      const response = await fetch(url)
      if (!response.ok) throw new Error('网络请求失败')

      const blob = await response.blob()
      const blobUrl = window.URL.createObjectURL(blob)

      const a = document.createElement('a')
      a.href = blobUrl
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)

      setTimeout(() => {
        window.URL.revokeObjectURL(blobUrl)
      }, 1000)
    } catch (error: any) {
      console.error('Download failed:', error)
      toast.error(`下载失败: ${error.message}`)
    }
  }, [])

  const handleSearchTag = async (value: string): Promise<Option[]> => {
    const res = await trpcClient.tag.list.query({
      cursor: 1,
      pageSize: 20,
      mode: 'popular',
      query: value
    })
    return res.items.map((tag) => ({
      value: tag.id.toString(),
      label: tag.name
    }))
  }

  const handleTagsChange = async (options: Option[]) => {
    const previousOptions = selectedTagOptions
    setSelectedTagOptions(options)

    options.forEach((opt) => {
      if (!previousOptions.some((t) => t.value === opt.value)) {
        addTag({ value: opt.value, label: opt.label })
      }
    })

    if (!artworkId) return
    if (!artwork.artist?.id) {
      toast.error('当前作品缺少作者信息，无法保存标签')
      return
    }

    saveTagsQueueRef.current = saveTagsQueueRef.current.then(async () => {
      setIsSavingTags(true)
      try {
        await trpcClient.artwork.update.mutate({
          id: artworkId,
          data: {
            title: artwork.title || '',
            description: artwork.description || '',
            artistId: artwork.artist.id,
            sourceDate: artwork.sourceDate || new Date(),
            tags: options.map((opt) => parseInt(opt.value))
          }
        })
        onSuccess?.()
      } catch (error: any) {
        toast.error(`标签保存失败: ${error.message}`)
      } finally {
        setIsSavingTags(false)
      }
    })
  }

  const columns: ProColumnDef<ImageListItem>[] = [
    {
      header: 'Order',
      accessorKey: 'sortOrder',
      size: 60,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.sortOrder}</span>
    },
    {
      header: '文件名 / 路径',
      accessorKey: 'path',
      cell: ({ getValue }) => {
        const val = getValue<string>()
        return (
          <div className="flex flex-col gap-0.5" onClick={() => setHoverImage(null)}>
            <span>
              <span
                className="font-medium text-sm cursor-help"
                onMouseEnter={(e) => handleMouseEnter(val, e)}
                onMouseLeave={handleMouseLeave}
              >
                {val.split('/').pop()}
              </span>
            </span>
            <span className="text-[10px] text-neutral-400 truncate max-w-[300px]" title={val}>
              {val}
            </span>
          </div>
        )
      }
    },
    {
      header: '尺寸',
      accessorKey: 'width',
      size: 100,
      cell: ({ row }) => (
        <span className="text-xs font-mono text-neutral-500">
          {row.original.width && row.original.height ? `${row.original.width} x ${row.original.height}` : '-'}
        </span>
      )
    },
    {
      header: '大小',
      accessorKey: 'size',
      size: 80,
      cell: ({ getValue }) => (
        <span className="text-xs text-neutral-500">{formatFileSize(getValue<number>() || 0)}</span>
      )
    },
    {
      header: '操作',
      id: 'actions',
      size: 40,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-primary"
            title="下载原图"
            onClick={(e) => {
              e.stopPropagation()
              handleDownload(row.original.path)
            }}
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            title="删除"
            onClick={(e) => {
              e.stopPropagation()
              setDeleteTarget(row.original.id)
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      )
    }
  ]

  const isDragging = useDragDropStore((state) => state.isDragging)
  const setDragging = useDragDropStore((state) => state.setDragging)
  const addFilesToQueue = useDragDropStore((state) => state.addFilesToQueue)

  const [dragZone, setDragZone] = useState<'add' | 'replace' | null>(null)
  const dragZoneRef = useRef<'add' | 'replace' | null>(null)
  const capturedZoneRef = useRef<'add' | 'replace' | null>(null)

  const updateDragZone = useCallback((zone: 'add' | 'replace' | null) => {
    setDragZone(zone)
    dragZoneRef.current = zone
  }, [])

  const { dragHandlers } = useDragImages({
    onDrop: (files) => {
      const currentZone = capturedZoneRef.current
      if (currentZone === 'add') {
        if (files.length > 0) {
          setAddInitialFile(files[0]!)
          const maxOrder = imageList.length > 0 ? Math.max(...imageList.map((i) => i.sortOrder)) : 0
          setDefaultAddOrder(maxOrder + 1)
          setShowAddDialog(true)
        }
      } else {
        addFilesToQueue(files)
        setShowReplaceDialog(true)
      }
      updateDragZone(null)
      capturedZoneRef.current = null
    },
    onDragStateChange: (dragging) => {
      setDragging(dragging)
      if (!dragging) updateDragZone(null)
    }
  })

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      dragHandlers.onDragOver(e)
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const width = rect.width
      const zone = x < width / 2 ? 'add' : 'replace'
      if (dragZoneRef.current !== zone) {
        updateDragZone(zone)
      }
    },
    [dragHandlers, updateDragZone]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const width = rect.width
      const zone = x < width / 2 ? 'add' : 'replace'
      capturedZoneRef.current = zone

      dragHandlers.onDrop(e)
    },
    [dragHandlers]
  )

  const finalDragHandlers = {
    ...dragHandlers,
    onDragOver: handleDragOver,
    onDrop: handleDrop
  }

  const firstImagePath = useMemo(() => {
    const [image] = artwork.images || []
    return image?.path ? image.path.split('/').slice(0, -1).join('/') : null
  }, [artwork])

  const getImageAspectRatio = useCallback((img: ImageListItem) => {
    if (!img.width || !img.height || img.width <= 0 || img.height <= 0) {
      return '3 / 4'
    }
    return `${img.width} / ${img.height}`
  }, [])

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="space-y-2 px-1 shrink-0 pt-2">
        <div className="flex items-center justify-between">
          <Label>快捷标签</Label>
          {isSavingTags && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin" />
              保存中
            </span>
          )}
        </div>
        <MultipleSelector
          placeholder="搜索并添加标签..."
          defaultOptions={selectedTagOptions}
          value={selectedTagOptions}
          onSearch={handleSearchTag}
          onChange={(options) => {
            void handleTagsChange(options)
          }}
          triggerSearchOnFocus
        />
        <RecentTagsList
          selectedValues={selectedTagOptions.map((t) => t.value)}
          onSelect={(tag) => {
            const exists = selectedTagOptions.some((t) => t.value === tag.value)
            if (exists) return
            void handleTagsChange([...selectedTagOptions, { value: tag.value, label: tag.label }])
          }}
        />
      </div>

      <div className="flex justify-between items-center px-1 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted p-1 rounded-md">
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-7 w-7', !showThumbnails && 'bg-background shadow-sm')}
              onClick={() => setShowThumbnails(false)}
              title="列表视图"
            >
              <ListIcon className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-7 w-7', showThumbnails && 'bg-background shadow-sm')}
              onClick={() => setShowThumbnails(true)}
              title="缩略图视图"
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setRefreshKey((k) => k + 1)
              onSuccess?.()
            }}
            className="h-8"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-2" />
            刷新
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAddInitialFile(null)
              setDefaultAddOrder(imageList.length > 0 ? Math.max(...imageList.map((i) => i.sortOrder)) + 1 : 1)
              setShowAddDialog(true)
            }}
            className="h-8"
          >
            <Plus className="w-3.5 h-3.5 mr-2" />
            新增图片
          </Button>

          <Button variant="danger" size="sm" onClick={() => setShowReplaceDialog(true)}>
            全量替换
          </Button>
        </div>
        {imageList.length > 0 && (
          <div className="text-xs text-muted-foreground flex items-center gap-3">
            <span className="font-mono" title={firstImagePath || ''}>
              {firstImagePath ? `...${firstImagePath.slice(-20)}` : ''}
            </span>
            <span>{imageList.length} 张</span>
            <span>•</span>
            <span>共: {formatFileSize(imageList.reduce((acc, cur) => acc + (cur.size || 0), 0))}</span>
          </div>
        )}
      </div>

      <div
        className={cn(
          'flex-1 min-h-0 relative flex flex-col transition-colors duration-150 ease-out',
          isDragging && 'bg-accent/10'
        )}
        {...finalDragHandlers}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 flex pointer-events-none bg-background/50 backdrop-blur-[1px] animate-in fade-in duration-200">
            <div
              className={cn(
                'flex-1 flex flex-col items-center justify-center h-full border-r-2 border-dashed transition-colors duration-200',
                dragZone === 'add' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-transparent border-muted-foreground/10'
              )}
            >
              <div
                className={cn(
                  'flex flex-col items-center transition-all duration-200',
                  dragZone === 'add' ? 'scale-110 opacity-100' : 'opacity-40 scale-90'
                )}
              >
                <Plus className="w-16 h-16 text-blue-500" strokeWidth={1.5} />
                <div className="mt-4 text-lg font-medium text-blue-500">新增图片</div>
              </div>
            </div>

            <div
              className={cn(
                'flex-1 flex flex-col items-center justify-center h-full transition-colors duration-200',
                dragZone === 'replace' ? 'bg-red-500/10' : 'bg-transparent'
              )}
            >
              <div
                className={cn(
                  'flex flex-col items-center transition-all duration-200',
                  dragZone === 'replace' ? 'scale-110 opacity-100' : 'opacity-40 scale-90'
                )}
              >
                <FileUp className="w-16 h-16 text-red-500" strokeWidth={1.5} />
                <div className="mt-4 text-lg font-medium text-red-500">全量替换</div>
              </div>
            </div>
          </div>
        )}
        {showThumbnails ? (
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
              {imageList.map((img, index) => {
                const fileName = img.path.split('/').pop() || ''
                return (
                  <div
                    key={img.id}
                    className="group relative overflow-hidden rounded-lg border bg-card shadow-sm transition-colors hover:border-primary/40"
                    onClick={() => setPreviewIndex(index)}
                  >
                    <div className="flex items-center justify-between gap-3 border-b bg-background/90 px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">#{img.sortOrder}</span>
                          <span className="truncate text-sm font-medium text-foreground" title={fileName}>
                            {fileName}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {img.width && img.height ? `${img.width} × ${img.height}` : '未知尺寸'}
                          {' · '}
                          {formatFileSize(img.size || 0)}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="secondary"
                          size="icon"
                          className="h-7 w-7 shadow-sm"
                          title="下载原图"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDownload(img.path)
                          }}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="h-7 w-7 shadow-sm"
                          title="删除"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteTarget(img.id)
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div
                      className="relative mx-auto w-full max-w-2xl bg-neutral-100/50 dark:bg-neutral-800/50"
                      style={{ aspectRatio: getImageAspectRatio(img) }}
                    >
                      <LazyImage
                        src={appendCacheKey(img.path, refreshKey)}
                        alt={img.path}
                        fill
                        className="object-contain p-3"
                        sizes="(max-width: 768px) 100vw, 720px"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <ZoomIn className="text-primary/50 w-8 h-8 drop-shadow-sm" />
                      </div>
                    </div>
                    <div className="border-t bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
                      <span className="block truncate" title={img.path}>
                        {img.path}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto h-full">
            <ProTable
              key={refreshKey}
              columns={columns}
              dataSource={imageList}
              defaultPageSize={50}
              className="h-full"
            />
          </div>
        )}
      </div>

      <HoverPreview src={hoverImage} x={hoverPos.x} y={hoverPos.y} visible={!!hoverImage} cacheKey={refreshKey} />

      <ImagePreviewDialog
        open={previewIndex !== null}
        onOpenChange={(open) => !open && setPreviewIndex(null)}
        images={imageList}
        currentIndex={previewIndex}
        onIndexChange={setPreviewIndex}
        cacheKey={refreshKey}
      />

      <AddImageDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSubmit={handleAddSubmit}
        isSubmitting={isAdding}
        progress={addProgress}
        defaultOrder={defaultAddOrder}
        initialFile={addInitialFile}
      />

      <ImageReplaceDialog
        open={showReplaceDialog}
        onOpenChange={setShowReplaceDialog}
        artworkId={artworkId}
        artwork={artwork}
        onSuccess={() => {
          onSuccess?.()
          setRefreshKey((k) => k + 1)
        }}
      />

      <ProDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除图片"
        description="确定要删除这张图片吗？"
        onOk={handleDelete}
        okText="确定删除"
        okButtonProps={{ variant: 'destructive' }}
        onCancel={() => setDeleteTarget(null)}
      >
        <div className="flex flex-row items-start space-x-3 space-y-0 py-4">
          <Checkbox
            id="delete-physical"
            checked={deletePhysical}
            onCheckedChange={(checked) => setDeletePhysical(checked as boolean)}
            className="mt-1"
          />
          <div className="space-y-1 leading-none">
            <Label
              htmlFor="delete-physical"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              同时删除物理文件
            </Label>
            <p className="text-xs text-muted-foreground">
              物理删除不可撤销（能否恢复取决于系统回收站），请确保拥有文件删除权限。
            </p>
          </div>
        </div>
      </ProDialog>
    </div>
  )
}
