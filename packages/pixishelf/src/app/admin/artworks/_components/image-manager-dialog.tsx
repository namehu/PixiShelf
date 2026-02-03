'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { useTRPCClient } from '@/lib/trpc'
import {
  RefreshCw,
  LayoutGrid,
  List as ListIcon,
  ZoomIn,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  FileUp,
  Trash2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProTable, ProColumnDef } from '@/components/shared/pro-table'
import { formatFileSize } from '@/utils/media'
import { ProDrawer } from '@/components/shared/pro-drawer'
import { ProDialog } from '@/components/shared/pro-dialog'
import { ImageReplaceDialog } from './image-replace-dialog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import Image from 'next/image'
import Link from 'next/link'
import { useInView } from 'react-intersection-observer'
import { useDragDropStore } from '../_store/drag-drop-store'
import { useDragImages } from '../_hooks/use-drag-images'

// --- Lazy Image Component ---
const LazyImage = ({ src, alt, className, ...props }: any) => {
  const { ref, inView } = useInView({
    triggerOnce: true,
    rootMargin: '100px 0px', // Preload when close
    threshold: 0.1
  })

  return (
    <div ref={ref} className={cn('relative w-full h-full bg-muted/30', className)}>
      {inView ? (
        <Image
          src={src}
          alt={alt}
          className={cn('transition-opacity duration-300', className)}
          loading="lazy"
          {...props}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/20">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}
    </div>
  )
}

// --- Hover Preview Portal ---
const HoverPreview = ({ src, x, y, visible }: { src: string | null; x: number; y: number; visible: boolean }) => {
  if (!visible || !src) return null

  // Create portal to body to ensure it's on top of everything
  if (typeof document === 'undefined') return null

  // Limit position to avoid overflow
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 1000
  const screenH = typeof window !== 'undefined' ? window.innerHeight : 800

  // Adjust position if too close to right/bottom edge
  const finalX = x + 320 > screenW ? x - 340 : x + 20
  const finalY = y + 320 > screenH ? y - 320 : y + 20

  return createPortal(
    <div
      className="fixed z-[9999] bg-background/95 backdrop-blur-sm border rounded-lg shadow-xl p-2 animate-in fade-in zoom-in-95 duration-200"
      style={{ left: finalX, top: finalY, width: 320, maxWidth: '90vw' }}
    >
      <div className="relative aspect-square w-full bg-black/5 rounded-md overflow-hidden">
        <Image src={src} alt="Preview" sizes="(max-width: 320px) 100vw, 320px" fill className="object-contain" />
      </div>
      <div className="mt-2 text-xs text-muted-foreground text-center break-all font-mono">{src.split('/').pop()}</div>
    </div>,
    document.body
  )
}

interface ImageManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artworkId: number | null
  firstImagePath?: string
  onSuccess?: () => void
}

// 图片列表项接口
interface ImageListItem {
  id: number
  path: string
  sortOrder: number
  width: number | null
  height: number | null
  size: number | null
}

export function ImageManagerDialog({
  open,
  onOpenChange,
  artworkId,
  firstImagePath,
  onSuccess
}: ImageManagerDialogProps) {
  const trpcClient = useTRPCClient()
  const [refreshKey, setRefreshKey] = useState(0)
  const [imageList, setImageList] = useState<ImageListItem[]>([])
  const [artwork, setArtwork] = useState<{ title?: string; externalId?: string }>({})

  // View State
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [showReplaceDialog, setShowReplaceDialog] = useState(false)

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
        setArtwork({ title: res.title, externalId: res.externalId || undefined })
        setImageList((res.images || []) as unknown as ImageListItem[])
      }
    })
  }, [artworkId, trpcClient])

  useEffect(() => {
    if (open && artworkId) {
      setRefreshKey((prev) => prev + 1)
      fetchArtworkData()
    }
  }, [open, artworkId, fetchArtworkData])

  // --- Lightbox Logic ---
  const handlePrev = () => {
    if (previewIndex !== null && previewIndex > 0) {
      setPreviewIndex(previewIndex - 1)
    }
  }

  const handleNext = () => {
    if (previewIndex !== null && previewIndex < imageList.length - 1) {
      setPreviewIndex(previewIndex + 1)
    }
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (previewIndex === null) return
      if (e.key === 'ArrowLeft') handlePrev()
      if (e.key === 'ArrowRight') handleNext()
      if (e.key === 'Escape') setPreviewIndex(null)
    },
    [previewIndex, imageList.length]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

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

  const { dragHandlers } = useDragImages({
    onDrop: (files) => {
      addFilesToQueue(files)
      setShowReplaceDialog(true)
    },
    onDragStateChange: setDragging
  })

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
            <span>图片路径: {firstImagePath} </span>
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
              isDragging && 'bg-[#1890ff]/10'
            )}
            {...dragHandlers}
          >
            {isDragging && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center pointer-events-none bg-background/50 backdrop-blur-[1px] animate-in fade-in duration-200">
                <style
                  dangerouslySetInnerHTML={{
                    __html: `
                  @keyframes breathe {
                    0%, 100% { transform: scale(0.8); }
                    50% { transform: scale(1); }
                  }
                `
                  }}
                />
                <div style={{ animation: 'breathe 1.5s infinite ease-in-out' }}>
                  <FileUp className="w-12 h-12 text-[#1890ff]" strokeWidth={1.5} />
                </div>
                <div className="mt-4 text-sm font-medium text-[#1890ff] animate-in slide-in-from-bottom-2 duration-200">
                  全量替换
                </div>
              </div>
            )}
            {showThumbnails ? (
              <div className="flex-1 overflow-y-auto p-2 pr-2">
                <div className="columns-[240px] gap-4 space-y-4">
                  {imageList.map((img, index) => {
                    // Calculate aspect ratio or default to square if missing
                    const aspectRatio = img.width && img.height ? img.width / img.height : 1

                    return (
                      <div
                        key={img.id}
                        className="group relative bg-muted rounded-md overflow-hidden border hover:ring-2 hover:ring-primary cursor-pointer shadow-sm break-inside-avoid"
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
                        <div style={{ aspectRatio: aspectRatio }} className="relative w-full">
                          <LazyImage
                            src={`${img.path}`}
                            alt={img.path}
                            fill
                            className="object-cover"
                            sizes="(max-width: 768px) 50vw, 240px"
                          />
                        </div>
                        <div className="absolute inset-0  opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                          <ZoomIn className="text-white w-6 h-6 opacity-30" />
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] p-1 truncate text-center backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity">
                          #{img.sortOrder}
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

      <HoverPreview src={hoverImage} x={hoverPos.x} y={hoverPos.y} visible={!!hoverImage} />

      {/* Lightbox Preview */}
      <Dialog open={previewIndex !== null} onOpenChange={(open) => !open && setPreviewIndex(null)}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-screen-xl w-full h-screen sm:h-[90vh] p-0 gap-0 bg-black/95 border-none flex flex-col overflow-hidden"
        >
          <DialogTitle className="sr-only">Image Preview</DialogTitle>
          {previewIndex !== null && imageList[previewIndex] && (
            <>
              <div className="absolute top-4 right-4 z-50 flex gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white/70 hover:text-white hover:bg-white/10 rounded-full"
                  onClick={() => setPreviewIndex(null)}
                >
                  <X className="w-6 h-6" />
                </Button>
              </div>

              <div className="flex-1 relative flex items-center justify-center w-full h-full overflow-hidden">
                <div className="relative w-full h-full">
                  <Image
                    src={imageList[previewIndex].path}
                    alt="Preview"
                    fill
                    className="object-contain"
                    quality={90}
                    priority
                  />
                </div>

                {/* Navigation */}
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white hover:bg-white/10 rounded-full w-12 h-12"
                  onClick={(e) => {
                    e.stopPropagation()
                    handlePrev()
                  }}
                  disabled={previewIndex === 0}
                >
                  <ChevronLeft className="w-8 h-8" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white hover:bg-white/10 rounded-full w-12 h-12"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleNext()
                  }}
                  disabled={previewIndex === imageList.length - 1}
                >
                  <ChevronRight className="w-8 h-8" />
                </Button>
              </div>

              <div className="h-16 bg-black/50 flex items-center justify-center text-white/80 gap-4 text-sm font-mono shrink-0">
                <span>
                  {previewIndex + 1} / {imageList.length}
                </span>
                <span>|</span>
                <span>{imageList[previewIndex].path.split('/').pop()}</span>
                <span>|</span>
                <span>
                  {imageList[previewIndex].width}x{imageList[previewIndex].height}
                </span>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

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
