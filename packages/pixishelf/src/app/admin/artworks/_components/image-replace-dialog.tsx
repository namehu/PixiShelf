import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, AlertTriangle, CheckCircle, XCircle, FolderInput, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { MEDIA_EXTENSIONS } from '../../../../../lib/constant'
import { extractOrderFromName } from '@/utils/artwork/extract-order-from-name'
import { formatFileSize } from '@/utils/media'

interface ImageReplaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artworkId: number | null
  artwork: { title?: string; externalId?: string }
  onSuccess?: () => void
}

type GlobalUploadStatus = 'idle' | 'backup' | 'uploading' | 'syncing' | 'success' | 'error'

interface PreviewItem {
  file: File
  originalName: string
  newName: string
  order: number
  size: number
  error?: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
}

export function ImageReplaceDialog({ open, onOpenChange, artworkId, artwork, onSuccess }: ImageReplaceDialogProps) {
  const [globalStatus, setGlobalStatus] = useState<GlobalUploadStatus>('idle')
  const [files, setFiles] = useState<File[]>([])
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([])

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setGlobalStatus('idle')
      setFiles([])
      setPreviewItems([])
    }
  }, [open])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files)
      const validFiles = selectedFiles.filter((f) => MEDIA_EXTENSIONS.includes('.' + (f.name.split('.').pop() || '')))
      setFiles(validFiles)
      generatePreview(validFiles)
    }
  }

  const generatePreview = (fileList: File[]) => {
    const items: PreviewItem[] = fileList.map((file) => {
      const order = extractOrderFromName(file.name)
      const ext = file.name.split('.').pop()
      const newName = `${artwork.externalId}_p${order}.${ext}`

      return {
        file,
        originalName: file.name,
        newName,
        order,
        size: file.size,
        status: 'pending',
        progress: 0
      }
    })

    validateAndSetItems(items)
  }

  const validateAndSetItems = (items: PreviewItem[]) => {
    const orderCounts = new Map<number, number>()
    items.forEach((item) => {
      orderCounts.set(item.order, (orderCounts.get(item.order) || 0) + 1)
    })

    const validatedItems = items.map((item) => ({
      ...item,
      error: orderCounts.get(item.order)! > 1 ? '排序序号冲突' : undefined
    }))

    validatedItems.sort((a, b) => a.order - b.order)
    setPreviewItems(validatedItems)
  }

  const handleOrderChange = (index: number, newOrder: number) => {
    const newItems = [...previewItems]
    const item = newItems[index]
    if (!item) return

    item.order = newOrder
    const ext = item.file.name.split('.').pop()
    item.newName = `${artwork.externalId}_p${newOrder}.${ext}`

    validateAndSetItems(newItems)
  }

  const handleReplace = async () => {
    if (!artworkId || files.length === 0) return
    if (previewItems.some((i) => i.error)) {
      toast.error('存在序号冲突，请先修正')
      return
    }

    setGlobalStatus('backup')

    try {
      // 1. Init (Backup)
      const initRes = await fetch(`/api/artwork/${artworkId}/replace?action=init`, { method: 'POST' })
      const initData = await initRes.json()
      if (!initRes.ok) throw new Error(initData.error || '初始化备份失败')

      const { uploadTargetDir, targetRelDir } = initData
      if (!uploadTargetDir) throw new Error('未能获取上传目标路径')

      setGlobalStatus('uploading')

      // 2. Upload Files
      const allUploadedMeta: any[] = []

      // Update all to pending
      setPreviewItems((prev) => prev.map((p) => ({ ...p, status: 'pending', progress: 0 })))

      for (let i = 0; i < previewItems.length; i++) {
        const item = previewItems[i]!

        // Update current item status
        setPreviewItems((prev) => {
          const newItems = [...prev]
          newItems[i] = { ...newItems[i]!, status: 'uploading', progress: 0 }
          return newItems
        })

        try {
          const meta = await uploadLargeFile(item.file, item.newName, uploadTargetDir, targetRelDir, (percent) => {
            setPreviewItems((prev) => {
              const newItems = [...prev]
              newItems[i] = { ...newItems[i]!, progress: percent }
              return newItems
            })
          })
          if (meta) allUploadedMeta.push(meta)

          setPreviewItems((prev) => {
            const newItems = [...prev]
            newItems[i] = { ...newItems[i]!, status: 'success', progress: 100 }
            return newItems
          })
        } catch (err: any) {
          setPreviewItems((prev) => {
            const newItems = [...prev]
            newItems[i] = { ...newItems[i]!, status: 'error', error: err.message }
            return newItems
          })
          throw new Error(`文件 ${item.originalName} 上传失败: ${err.message}`)
        }
      }

      // 3. Commit
      setGlobalStatus('syncing')
      const commitRes = await fetch(`/api/artwork/${artworkId}/replace?action=commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filesMeta: allUploadedMeta })
      })

      if (!commitRes.ok) throw new Error('数据库同步失败')

      setGlobalStatus('success')
      toast.success('全量替换成功')
      onSuccess?.()
      onOpenChange(false)
    } catch (error: any) {
      console.error(error)
      setGlobalStatus('error')
      toast.error(`操作失败: ${error.message}`)

      // Rollback
      try {
        await fetch(`/api/artwork/${artworkId}/replace?action=rollback`, { method: 'POST' })
        toast.info('已自动回滚至原状态')
      } catch (e) {
        toast.error('回滚失败，请手动检查文件')
      }
    }
  }

  const uploadLargeFile = async (
    file: File,
    fileName: string,
    targetDir: string,
    targetRelDir: string,
    onProgress: (percent: number) => void
  ): Promise<any> => {
    const CHUNK_SIZE = 10 * 1024 * 1024 // 10MB
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    let lastMeta = null

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)

      const headers: Record<string, string> = {
        'x-file-name': encodeURIComponent(fileName),
        'x-target-dir': encodeURIComponent(targetDir),
        'x-target-rel-dir': encodeURIComponent(targetRelDir || ''),
        'x-chunk-index': chunkIndex.toString(),
        'x-total-chunks': totalChunks.toString()
      }

      const res = await fetch('/api/artwork/upload-chunk', {
        method: 'POST',
        headers,
        body: chunk
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Chunk ${chunkIndex} failed`)
      }

      if (chunkIndex === totalChunks - 1) {
        const json = await res.json()
        if (json.meta) {
          lastMeta = json.meta[0]
        }
      }

      onProgress(Math.round(((chunkIndex + 1) / totalChunks) * 100))
    }

    return lastMeta
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (globalStatus === 'uploading' || globalStatus === 'syncing') return
        onOpenChange(val)
      }}
    >
      <DialogContent className="sm:max-w-4xl max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>全量替换 - {artwork.title || artwork.externalId}</DialogTitle>
          <DialogDescription>
            将会清空当前作品的所有图片，并替换为上传的新文件。请确保文件名包含排序序号（如 _p1.jpg）。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-1 space-y-4">
          {/* File Selection */}
          <div className="border-2 border-dashed border-neutral-200 rounded-lg p-6 text-center hover:bg-neutral-50 transition-colors relative">
            <input
              type="file"
              multiple
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={handleFileSelect}
              disabled={globalStatus === 'uploading' || globalStatus === 'syncing'}
            />
            <div className="flex flex-col items-center gap-2 text-neutral-500">
              <FolderInput className="w-8 h-8 text-neutral-400" />
              <p className="text-sm font-medium">点击选择文件夹 或 拖拽文件到此处</p>
              <p className="text-xs text-neutral-400">支持批量选择，自动解析排序序号</p>
            </div>
          </div>

          {/* Global Status */}
          {globalStatus !== 'idle' && (
            <div className="flex items-center gap-2 text-sm p-2 bg-muted rounded">
              {globalStatus === 'backup' && <Loader2 className="w-4 h-4 animate-spin" />}
              {globalStatus === 'uploading' && <Loader2 className="w-4 h-4 animate-spin" />}
              {globalStatus === 'syncing' && <RefreshCw className="w-4 h-4 animate-spin" />}
              {globalStatus === 'success' && <CheckCircle className="w-4 h-4 text-green-500" />}
              {globalStatus === 'error' && <XCircle className="w-4 h-4 text-red-500" />}

              <span className="font-medium">
                {globalStatus === 'backup' && '正在备份旧文件...'}
                {globalStatus === 'uploading' && '正在上传文件...'}
                {globalStatus === 'syncing' && '正在同步数据库...'}
                {globalStatus === 'success' && '替换成功'}
                {globalStatus === 'error' && '操作失败'}
              </span>
            </div>
          )}

          {/* Preview List */}
          {previewItems.length > 0 && (
            <div className="border rounded-md overflow-hidden">
              <div className="bg-neutral-100 px-4 py-2 text-xs font-medium text-neutral-500 flex justify-between items-center">
                <span>待上传: {previewItems.length} 个文件</span>
                <span className="text-neutral-400">
                  总大小: {formatFileSize(previewItems.reduce((acc, cur) => acc + cur.size, 0))}
                </span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10">
                    <TableRow>
                      <TableHead className="w-[80px]">Order</TableHead>
                      <TableHead>原文件名</TableHead>
                      <TableHead>新文件名</TableHead>
                      <TableHead className="w-[150px]">进度</TableHead>
                      <TableHead className="w-[80px]">状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewItems.map((item, index) => (
                      <TableRow key={index} className={cn(item.error && 'bg-red-50')}>
                        <TableCell>
                          <Input
                            type="number"
                            value={item.order}
                            onChange={(e) => handleOrderChange(index, parseInt(e.target.value) || 0)}
                            className="h-7 w-16 text-center px-1"
                            disabled={globalStatus !== 'idle'}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs truncate max-w-[150px]" title={item.originalName}>
                          {item.originalName}
                        </TableCell>
                        <TableCell
                          className="font-mono text-xs text-neutral-500 truncate max-w-[150px]"
                          title={item.newName}
                        >
                          {item.newName}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={item.progress} className="h-2 w-20" />
                            <span className="text-[10px] text-muted-foreground">{item.progress}%</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.error ? (
                            <span className="text-red-500 text-xs flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              冲突
                            </span>
                          ) : item.status === 'success' ? (
                            <span className="text-green-500 text-xs flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" />
                              完成
                            </span>
                          ) : item.status === 'error' ? (
                            <span className="text-red-500 text-xs flex items-center gap-1">
                              <XCircle className="w-3 h-3" />
                              失败
                            </span>
                          ) : (
                            <span className="text-neutral-400 text-xs">等待</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={globalStatus === 'uploading' || globalStatus === 'syncing'}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={handleReplace}
            disabled={
              files.length === 0 ||
              globalStatus === 'uploading' ||
              globalStatus === 'syncing' ||
              previewItems.some((i) => i.error)
            }
          >
            {globalStatus === 'uploading' ? '上传中...' : '确认全量替换'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
