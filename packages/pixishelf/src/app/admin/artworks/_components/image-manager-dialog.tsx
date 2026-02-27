'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useTRPCClient } from '@/lib/trpc'
import { RefreshCw, LayoutGrid, List as ListIcon, ZoomIn, FileUp, Trash2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProTable, ProColumnDef } from '@/components/shared/pro-table'
import { formatFileSize } from '@/utils/media'
import { ProDrawer } from '@/components/shared/pro-drawer'
import { ProDialog } from '@/components/shared/pro-dialog'
import { ImageReplaceDialog } from './image-replace-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useChunkUpload } from '../_hooks/use-chunk-upload'
import { toast } from 'sonner'
import Link from 'next/link'
import { useDragDropStore } from '../_store/drag-drop-store'
import { useDragImages } from '../_hooks/use-drag-images'
import { type ArtworkResponseDto } from '@/schemas/artwork.dto'
import { LazyImage } from './lazy-image'
import { HoverPreview } from './hover-preview'
import { ImagePreviewDialog } from './image-preview-dialog'
import { AddImageDialog } from './add-image-dialog'
import { appendCacheKey } from './utils'
import { ImageListItem } from './types'

interface ImageManagerDialogProps {
  open: boolean
  data?: ArtworkResponseDto | null
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function ImageManagerDialog({ open, onOpenChange, data, onSuccess }: ImageManagerDialogProps) {
  const { id: artworkId } = data ?? {}

  const trpcClient = useTRPCClient()
  const [refreshKey, setRefreshKey] = useState(0)
  const [imageList, setImageList] = useState<ImageListItem[]>([])
  const [artwork, setArtwork] = useState<Partial<Pick<ArtworkResponseDto, 'title' | 'externalId' | 'images'>>>({})

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

      // 1. Get upload path
      const { targetDir, targetRelDir } = await trpcClient.artwork.getUploadPath.query(artworkId)

      // 2. Generate filename: {externalId}_p{order}.{ext}
      const ext = file.name.split('.').pop() || ''
      const fileName = `${artwork.externalId}_p${order}.${ext}`

      // 3. Upload file
      const meta = await uploadSingleFile(file, fileName, targetDir, targetRelDir, (progress) => {
        setAddProgress(progress)
      })

      if (!meta) {
        throw new Error('Upload failed: No metadata returned')
      }

      // 4. Add database record
      await trpcClient.artwork.addImage.mutate({
        artworkId,
        file: {
          fileName: meta.fileName,
          order: order,
          width: meta.width,
          height: meta.height,
          size: meta.size,
          path: meta.path // This should be the relative path returned by upload
        }
      })

      toast.success('图片添加成功')
      setShowAddDialog(false)
      setRefreshKey((k) => k + 1)
      fetchArtworkData()
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
      // Refresh
      setRefreshKey((k) => k + 1)
      fetchArtworkData()
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

  const fetchArtworkData = useCallback(() => {
    if (!artworkId) return
    trpcClient.artwork.getById.query(artworkId).then((res) => {
      if (res) {
        setArtwork({ title: res.title, externalId: res.externalId || undefined, images: res.images || [] })
        setImageList((res.images || []) as unknown as ImageListItem[])
      }
    })
  }, [artworkId, trpcClient])

  useEffect(() => {
    if (open && artworkId) {
      // Reset UI states
      setShowReplaceDialog(false)
      setShowAddDialog(false)
      setPreviewIndex(null)
      setHoverImage(null)
      setDeleteTarget(null)
      setIsAdding(false)
      setAddProgress(0)

      setRefreshKey((prev) => prev + 1)
      fetchArtworkData()
    } else if (!open) {
      // Clear sensitive data when closed to prevent flashing old data on next open
      // Optional: keep cache for better UX if reopening same item
      // But requirement says "reset before open", so clearing on close or open is fine.
      // We'll rely on fetchArtworkData to populate.
    }
  }, [open, artworkId, fetchArtworkData])

  // --- Table Columns ---
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
          <div
            className="flex flex-col gap-0.5"
            onClick={() => setHoverImage(null)} // Close on click if needed
          >
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
      size: 60,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation()
            setDeleteTarget(row.original.id)
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )
    }
  ]

  // --- Drag & Drop Logic ---
  // Use selectors to prevent unnecessary re-renders
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
      // Use captured zone from drop event
      const currentZone = capturedZoneRef.current
      if (currentZone === 'add') {
        if (files.length > 0) {
          setAddInitialFile(files[0]!)
          const maxOrder = imageList.length > 0 ? Math.max(...imageList.map((i) => i.sortOrder)) : 0
          setDefaultAddOrder(maxOrder + 1)
          setShowAddDialog(true)
        }
      } else {
        // Default to replace logic
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

      // Capture zone before useDragImages resets state
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const width = rect.width
      const zone = x < width / 2 ? 'add' : 'replace'
      capturedZoneRef.current = zone

      // Pass event to useDragImages handler
      // If for some reason useDragImages fails to process, we can add a fallback here if needed
      // But adding e.preventDefault() here is crucial for some browsers
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

  return (
    <>
      <ProDrawer
        open={open}
        onOpenChange={onOpenChange}
        direction="right"
        title={
          <div className="flex items-center gap-2">
            <span>图片管理</span>
            <span className="text-sm font-normal text-muted-foreground px-2 py-0.5 bg-muted rounded-md">
              {artwork?.title ? (
                <Link href={`/artworks/${artworkId}`} target="_blank" rel="noopener noreferrer">
                  {artwork.title}
                </Link>
              ) : (
                'Loading...'
              )}
            </span>
          </div>
        }
        description={
          <span className="flex items-center gap-2 text-xs select-text cursor-text">
            <span className="font-mono">ID: {artwork.externalId}</span>
            <span>•</span>
            <span>上传路径: {firstImagePath} </span>
          </span>
        }
        width="80%"
        footer={null}
      >
        <div className="flex flex-col h-full gap-4">
          {/* Toolbar */}
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
                  fetchArtworkData()
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
                <span>{imageList.length} 张</span>
                <span>•</span>
                <span>共: {formatFileSize(imageList.reduce((acc, cur) => acc + (cur.size || 0), 0))}</span>
              </div>
            )}
          </div>

          {/* Content */}
          <div
            className={cn(
              'flex-1 min-h-0 relative flex flex-col transition-colors duration-150 ease-out',
              isDragging && 'bg-accent/10'
            )}
            {...finalDragHandlers}
          >
            {isDragging && (
              <div className="absolute inset-0 z-50 flex pointer-events-none bg-background/50 backdrop-blur-[1px] animate-in fade-in duration-200">
                {/* Left Zone: Add */}
                <div
                  className={cn(
                    'flex-1 flex flex-col items-center justify-center h-full border-r-2 border-dashed transition-colors duration-200',
                    dragZone === 'add'
                      ? 'bg-blue-500/10 border-blue-500/30'
                      : 'bg-transparent border-muted-foreground/10'
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

                {/* Right Zone: Replace */}
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
              <div className="flex-1 overflow-y-auto p-2 pr-2">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                  {imageList.map((img, index) => {
                    const fileName = img.path.split('/').pop() || ''
                    return (
                      <div
                        key={img.id}
                        className="group relative bg-muted rounded-md overflow-hidden border hover:ring-2 hover:ring-primary cursor-pointer shadow-sm flex flex-col"
                        onClick={() => setPreviewIndex(index)}
                      >
                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                          <Button
                            variant="destructive"
                            size="icon"
                            className="h-6 w-6 shadow-sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteTarget(img.id)
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                        <div className="relative w-full aspect-square bg-neutral-100/50 dark:bg-neutral-800/50">
                          <LazyImage
                            src={appendCacheKey(img.path, refreshKey)}
                            alt={img.path}
                            fill
                            className="object-contain p-2"
                            sizes="(max-width: 768px) 50vw, 200px"
                          />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            <ZoomIn className="text-primary/50 w-8 h-8 drop-shadow-sm" />
                          </div>
                        </div>
                        <div className="p-2 bg-background border-t text-xs space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-muted-foreground shrink-0">#{img.sortOrder}</span>
                            <span className="truncate font-medium text-foreground" title={fileName}>
                              {fileName}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground text-right truncate">
                            {img.width && img.height ? `${img.width} × ${img.height}` : ''}
                          </div>
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
        </div>
      </ProDrawer>

      <HoverPreview src={hoverImage} x={hoverPos.x} y={hoverPos.y} visible={!!hoverImage} cacheKey={refreshKey} />

      {/* Lightbox Preview */}
      <ImagePreviewDialog
        open={previewIndex !== null}
        onOpenChange={(open) => !open && setPreviewIndex(null)}
        images={imageList}
        currentIndex={previewIndex}
        onIndexChange={setPreviewIndex}
        cacheKey={refreshKey}
      />

      {/* Add Image Dialog */}
      <AddImageDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        onSubmit={handleAddSubmit}
        isSubmitting={isAdding}
        progress={addProgress}
        defaultOrder={defaultAddOrder}
        initialFile={addInitialFile}
      />

      {/* Replace Dialog */}
      <ImageReplaceDialog
        open={showReplaceDialog}
        onOpenChange={setShowReplaceDialog}
        artworkId={artworkId}
        artwork={artwork}
        onSuccess={() => {
          onSuccess?.()
          setRefreshKey((k) => k + 1)
          fetchArtworkData()
        }}
      />

      {/* Delete Confirmation Dialog */}
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
    </>
  )
}
