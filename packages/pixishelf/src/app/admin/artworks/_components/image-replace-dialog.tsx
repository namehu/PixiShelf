import { useState, useEffect, useRef, Fragment, useMemo } from 'react'
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
import {
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  FolderInput,
  RefreshCw,
  RotateCcw,
  FileWarning,
  Download,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { MEDIA_EXTENSIONS, VIDEO_EXTENSIONS } from '../../../../../lib/constant'
import { extractOrderFromName } from '@/utils/artwork/extract-order-from-name'
import { formatFileSize } from '@/utils/media'
import { guid } from '@/utils/guid'
import { useThrottleFn } from 'ahooks'

interface ImageReplaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artworkId: number | null
  artwork: { title?: string; externalId?: string }
  onSuccess?: () => void
}

type GlobalUploadStatus =
  | 'idle'
  | 'backup'
  | 'uploading'
  | 'syncing'
  | 'success'
  | 'error'
  | 'partial-error'
  | 'rolling-back' // ROLLBACK-TODO: 新增状态

interface PreviewItem {
  id: string
  file: File
  originalName: string
  newName: string
  order: number
  size: number
  error?: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  previewUrl?: string
}

export function ImageReplaceDialog({ open, onOpenChange, artworkId, artwork, onSuccess }: ImageReplaceDialogProps) {
  const [globalStatus, setGlobalStatus] = useState<GlobalUploadStatus>('idle')
  const [files, setFiles] = useState<File[]>([])
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([])
  const [uploadConfig, setUploadConfig] = useState<{ uploadTargetDir: string; targetRelDir: string } | null>(null)
  // Use ref to store uploaded meta to avoid closure staleness issues in async flows
  const uploadedMetaRef = useRef<Record<string, any>>({})
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isCommittingRef = useRef(false)
  const lastScrolledIdRef = useRef<string | null>(null)
  const prevFileCountRef = useRef(0)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setGlobalStatus('idle')
      setFiles([])
      setPreviewItems([])
      setUploadConfig(null)
      uploadedMetaRef.current = {}
      isCommittingRef.current = false
      lastScrolledIdRef.current = null
      prevFileCountRef.current = 0
    }
  }, [open])

  // 1. Calculate active item ID (low frequency)
  const activeItemId = useMemo(() => {
    if (globalStatus !== 'uploading') return null
    const item = previewItems.find((i) => i.status === 'uploading')
    return item ? item.id : null
  }, [previewItems, globalStatus])

  // 2. Scroll control logic
  const { run: runThrottledScroll } = useThrottleFn(
    (id: string) => {
      const row = document.getElementById(`row-${id}`)
      const container = scrollContainerRef.current

      if (row && container) {
        const rowTop = row.offsetTop
        const rowBottom = rowTop + row.offsetHeight
        const containerTop = container.scrollTop
        const containerBottom = containerTop + container.clientHeight

        const isAbove = rowTop < containerTop
        const isBelow = rowBottom > containerBottom

        if (isAbove || isBelow) {
          // 计算当前视口位置与目标位置的距离
          // 如果距离过大（例如 > 2000px），使用 'auto' 瞬间跳转，避免过长的平滑滚动导致等待
          const distance = Math.abs(containerTop - rowTop)
          const isFar = distance > 2000

          row.scrollIntoView({
            behavior: isFar ? 'auto' : 'smooth', // 智能切换滚动模式
            block: 'nearest'
          })
        }
      }
    },
    { wait: 200 } // 200ms 节流，平衡流畅度与性能
  )

  useEffect(() => {
    if (!activeItemId || activeItemId === lastScrolledIdRef.current) return

    lastScrolledIdRef.current = activeItemId

    // 调用节流滚动函数
    runThrottledScroll(activeItemId)
  }, [activeItemId, runThrottledScroll])

  // 3. Auto-scroll to bottom when new files are added
  useEffect(() => {
    if (previewItems.length > prevFileCountRef.current && prevFileCountRef.current !== 0) {
      setTimeout(() => {
        scrollContainerRef.current?.scrollTo({ top: 99999, behavior: 'smooth' })
      }, 100)
    }
    prevFileCountRef.current = previewItems.length
  }, [previewItems.length])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files)
      addFiles(selectedFiles)
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (globalStatus === 'uploading' || globalStatus === 'syncing') return

    const items = e.dataTransfer.items
    if (!items) return

    const fileList: File[] = []

    const scanEntry = async (entry: any) => {
      if (entry.isFile) {
        return new Promise<void>((resolve) => {
          entry.file((file: File) => {
            fileList.push(file)
            resolve()
          })
        })
      } else if (entry.isDirectory) {
        const reader = entry.createReader()
        const readEntries = async () => {
          return new Promise<void>((resolve) => {
            reader.readEntries(async (entries: any[]) => {
              if (entries.length === 0) {
                resolve()
                return
              }
              await Promise.all(entries.map(scanEntry))
              await readEntries() // Continue reading
              resolve()
            })
          })
        }
        await readEntries()
      }
    }

    const promises = []
    for (const item of Array.from(items)) {
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null
      if (entry) {
        promises.push(scanEntry(entry))
      } else if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) fileList.push(file)
      }
    }

    await Promise.all(promises)
    if (fileList.length > 0) {
      addFiles(fileList)
    }
  }

  const addFiles = (newFiles: File[]) => {
    const validFiles = newFiles.filter((f) =>
      MEDIA_EXTENSIONS.includes('.' + (f.name.split('.').pop() || '').toLowerCase())
    )
    if (validFiles.length === 0) {
      toast.warning('未找到符合格式的媒体文件')
      return
    }

    setFiles((prev) => [...prev, ...validFiles])

    const newItems = validFiles.map((file) => {
      const order = extractOrderFromName(file.name)
      const ext = file.name.split('.').pop()
      const newName = `${artwork.externalId}_p${order}.${ext}`

      return {
        id: guid(),
        file,
        originalName: file.name,
        newName,
        order,
        size: file.size,
        status: 'pending' as const,
        progress: 0,
        previewUrl: URL.createObjectURL(file)
      }
    })

    setPreviewItems((prev) => {
      const combined = [...prev, ...newItems]
      return validateItems(combined)
    })
  }

  const validateItems = (items: PreviewItem[]) => {
    const orderCounts = new Map<number, number>()
    items.forEach((item) => {
      orderCounts.set(item.order, (orderCounts.get(item.order) || 0) + 1)
    })

    const validatedItems = items.map((item) => ({
      ...item,
      error: orderCounts.get(item.order)! > 1 ? '排序序号冲突' : undefined
    }))

    validatedItems.sort((a, b) => a.order - b.order)
    return validatedItems
  }

  const handleOrderChange = (index: number, newOrder: number) => {
    const newItems = [...previewItems]
    const item = newItems[index]
    if (!item) return

    item.order = newOrder
    const ext = item.file.name.split('.').pop()
    item.newName = `${artwork.externalId}_p${newOrder}.${ext}`

    setPreviewItems(validateItems(newItems))
  }

  const handleRemoveItem = (index: number) => {
    if (!confirm('确定要删除该文件吗？')) return

    setPreviewItems((prev) => {
      const newItems = [...prev]
      const removed = newItems.splice(index, 1)[0]
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return validateItems(newItems)
    })
  }

  // ROLLBACK-TODO: 客户端回滚执行函数
  const executeRollback = async () => {
    setGlobalStatus('rolling-back')
    const res = await fetch(`/api/artwork/${artworkId}/replace?action=rollback`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      // 忽略 "No active backup" 错误，视为回滚成功
      if (!(res.status === 400 && data.error?.includes('No active backup'))) {
        throw new Error(data.error || '回滚请求失败')
      }
    }

    // 重置本地状态
    previewItems.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl))
    setFiles([])
    setPreviewItems([])
    setUploadConfig(null)
    uploadedMetaRef.current = {}
    return true
  }

  const startReplace = async () => {
    if (!artworkId || previewItems.length === 0) return
    if (previewItems.some((i) => i.error)) {
      toast.error('存在序号冲突，请先修正')
      return
    }

    setGlobalStatus('backup')

    try {
      let config = uploadConfig
      if (!config) {
        const initRes = await fetch(`/api/artwork/${artworkId}/replace?action=init`, { method: 'POST' })
        const initData = await initRes.json()
        if (!initRes.ok) throw new Error(initData.error || '初始化备份失败')

        config = {
          uploadTargetDir: initData.uploadTargetDir,
          targetRelDir: initData.targetRelDir
        }
        setUploadConfig(config)
      }

      setGlobalStatus('uploading')
      processQueue(config)
    } catch (error: any) {
      console.error(error)
      setGlobalStatus('error')
      toast.error(`初始化失败: ${error.message}`)
    }
  }

  const processQueue = async (config: { uploadTargetDir: string; targetRelDir: string }) => {
    // Filter items that need processing
    const itemsToProcess = previewItems.filter(
      (item) => (item.status === 'pending' || item.status === 'error') && !uploadedMetaRef.current[item.id]
    )

    if (itemsToProcess.length === 0) {
      checkFinalStatus()
      return
    }

    const uploadItems = itemsToProcess.map((item) => ({
      id: item.id,
      file: item.file,
      newName: item.newName
    }))

    await uploadLargeFile(uploadItems, config.uploadTargetDir, config.targetRelDir, 3, {
      onStart: (id) => {
        setPreviewItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, status: 'uploading', progress: 0, error: undefined } : item))
        )
      },
      onProgress: (id, percent) => {
        setPreviewItems((prev) => prev.map((item) => (item.id === id ? { ...item, progress: percent } : item)))
      },
      onSuccess: (id, meta) => {
        uploadedMetaRef.current[id] = meta
        setPreviewItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, status: 'success', progress: 100 } : item))
        )
      },
      onError: (id, err) => {
        setPreviewItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, status: 'error', error: err.message } : item))
        )
      }
    })

    checkFinalStatus()
  }

  const checkFinalStatus = () => {
    setPreviewItems((currentItems) => {
      const anyError = currentItems.some((i) => i.status === 'error')
      const anyPending = currentItems.some((i) => i.status === 'pending')

      if (anyError) {
        setGlobalStatus('partial-error')
      } else if (!anyPending) {
        // All done, trigger commit automatically
        // Use setTimeout to move side effect out of updater function
        toast.success('所有文件上传完成，准备提交...')
        setTimeout(() => {
          commitReplace(currentItems)
        }, 250)
      } else {
        // Should be idle if interrupted
        setGlobalStatus('idle')
      }
      return currentItems
    })
  }

  const commitReplace = async (items: PreviewItem[], ignoreErrors = false) => {
    if (isCommittingRef.current) return
    isCommittingRef.current = true

    setGlobalStatus('syncing')

    try {
      const metas = items
        .filter((item) => (ignoreErrors ? item.status === 'success' : true))
        .map((item) => uploadedMetaRef.current[item.id])
        .filter(Boolean)

      const commitRes = await fetch(`/api/artwork/${artworkId}/replace?action=commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filesMeta: metas })
      })

      if (!commitRes.ok) {
        // [新增] 如果后端返回 400 重复错误，可以在这里处理
        const errorData = await commitRes.json()
        throw new Error(errorData.error || '数据库同步失败')
      }

      setGlobalStatus('success')
      toast.success('替换完成')
      onSuccess?.()
      onOpenChange(false)
    } catch (error: any) {
      console.error(error)
      // ROLLBACK-TODO: 提交失败触发自动回滚
      toast.error(`提交失败: ${error.message}，正在回滚...`)

      try {
        await executeRollback()
        setGlobalStatus('idle')
        toast.info('已自动回滚到初始状态，请重试')
      } catch (rollbackError: any) {
        setGlobalStatus('error')
        toast.error(`严重错误：回滚失败 (${rollbackError.message})`)
      }
    } finally {
      isCommittingRef.current = false
    }
  }

  const handleRetryAllFailed = () => {
    if (!uploadConfig) return
    setGlobalStatus('uploading')
    processQueue(uploadConfig)
  }

  const handleRetrySingle = (index: number) => {
    if (!uploadConfig) return
    setPreviewItems((prev) => {
      const newItems = [...prev]
      const currentItem = newItems[index]
      if (currentItem) {
        newItems[index] = { ...currentItem, status: 'pending', error: undefined }
      }
      return newItems
    })
    setGlobalStatus('uploading')
    processQueue(uploadConfig)
  }

  const handleIgnoreAndCommit = () => {
    if (confirm('确定要忽略失败文件并提交吗？失败的文件将不会出现在最终作品中。')) {
      commitReplace(previewItems, true)
    }
  }

  const exportErrorReport = () => {
    const failedItems = previewItems.filter((i) => i.status === 'error')
    const content = failedItems
      .map((i) => `File: ${i.originalName}\nError: ${i.error}\nOrder: ${i.order}\n---`)
      .join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `upload-errors-${artwork.externalId}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  /**
   * Upload a single file in chunks (Internal)
   */
  const uploadSingleFile = async (
    file: File,
    fileName: string,
    targetDir: string,
    targetRelDir: string,
    onProgress: (percent: number) => void
  ): Promise<any> => {
    const CHUNK_SIZE = 10 * 1024 * 1024 // 10MB
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
    let lastMeta = null

    // 1. Check if file exists on server to resume (Video only)
    let resumeIndex = 0
    const isVideo = VIDEO_EXTENSIONS.includes('.' + (fileName.split('.').pop() || '').toLowerCase())

    if (isVideo) {
      try {
        const checkUrl = `/api/artwork/upload-chunk?fileName=${encodeURIComponent(
          fileName
        )}&targetDir=${encodeURIComponent(targetDir)}`
        const checkRes = await fetch(checkUrl)
        if (checkRes.ok) {
          const checkData = await checkRes.json()
          if (checkData.exists && checkData.size > 0) {
            // If file exists, resume from the last complete chunk
            resumeIndex = Math.floor(checkData.size / CHUNK_SIZE)
          }
        }
      } catch (e) {
        console.warn('Failed to check file status, starting from scratch', e)
      }
    }

    const startIndex = Math.min(resumeIndex, Math.max(0, totalChunks - 1))

    for (let chunkIndex = startIndex; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, file.size)
      const chunk = file.slice(start, end)

      const headers: Record<string, string> = {
        'x-file-name': encodeURIComponent(fileName),
        'x-target-dir': encodeURIComponent(targetDir),
        'x-target-rel-dir': encodeURIComponent(targetRelDir || ''),
        'x-chunk-index': chunkIndex.toString(),
        'x-total-chunks': totalChunks.toString(),
        'x-offset': start.toString()
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

  /**
   * Batch upload files with concurrency control
   */
  const uploadLargeFile = async (
    items: { id: string; file: File; newName: string }[],
    targetDir: string,
    targetRelDir: string,
    concurrency: number = 3,
    callbacks?: {
      onStart?: (id: string) => void
      onProgress?: (id: string, percent: number) => void
      onSuccess?: (id: string, meta: any) => void
      onError?: (id: string, error: Error) => void
    }
  ): Promise<Array<{ id: string; meta?: any; error?: Error; status: 'success' | 'error' }>> => {
    const resultsMap = new Map<string, { id: string; meta?: any; error?: Error; status: 'success' | 'error' }>()
    const executing = new Set<Promise<void>>()

    const runTask = async (item: (typeof items)[0]) => {
      callbacks?.onStart?.(item.id)
      try {
        const meta = await uploadSingleFile(item.file, item.newName, targetDir, targetRelDir, (p) =>
          callbacks?.onProgress?.(item.id, p)
        )
        callbacks?.onSuccess?.(item.id, meta)
        resultsMap.set(item.id, { id: item.id, meta, status: 'success' })
      } catch (err: any) {
        callbacks?.onError?.(item.id, err)
        resultsMap.set(item.id, { id: item.id, error: err, status: 'error' })
      }
    }

    for (const item of items) {
      const p = runTask(item).then(() => {
        executing.delete(p)
      })
      executing.add(p)

      if (executing.size >= concurrency) {
        await Promise.race(executing)
      }
    }

    await Promise.all(executing)

    return items.map((item) => resultsMap.get(item.id)!)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (globalStatus === 'uploading' || globalStatus === 'syncing' || globalStatus === 'rolling-back') return
        onOpenChange(val)
      }}
    >
      <DialogContent className="sm:max-w-4xl max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>全量替换 - {artwork.title || artwork.externalId}</DialogTitle>
          <DialogDescription>将会清空当前作品的所有图片，并替换为上传的新文件。支持拖拽文件夹。</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-1 space-y-4">
          {/* File Selection */}
          <div
            className={cn(
              'border-2 border-dashed border-neutral-200 rounded-lg p-6 text-center transition-colors relative',
              globalStatus === 'uploading' || globalStatus === 'syncing' || globalStatus === 'rolling-back'
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-neutral-50 cursor-pointer'
            )}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <input
              type="file"
              multiple
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              onChange={handleFileSelect}
              disabled={globalStatus === 'uploading' || globalStatus === 'syncing' || globalStatus === 'rolling-back'}
            />
            <div className="flex flex-col items-center gap-2 text-neutral-500">
              <FolderInput className="w-8 h-8 text-neutral-400" />
              <p className="text-sm font-medium">点击选择 / 拖拽文件夹或文件</p>
              <p className="text-xs text-neutral-400">支持批量选择，自动解析排序序号</p>
            </div>
          </div>

          {/* Global Status */}
          {globalStatus !== 'idle' && (
            <div
              className={cn(
                'flex items-center gap-2 text-sm p-3 rounded border',
                globalStatus === 'partial-error' ? 'bg-amber-50 border-amber-200' : 'bg-muted'
              )}
            >
              {globalStatus === 'backup' && <Loader2 className="w-4 h-4 animate-spin" />}
              {globalStatus === 'uploading' && <Loader2 className="w-4 h-4 animate-spin" />}
              {globalStatus === 'syncing' && <RefreshCw className="w-4 h-4 animate-spin" />}
              {globalStatus === 'success' && <CheckCircle className="w-4 h-4 text-green-500" />}
              {globalStatus === 'error' && <XCircle className="w-4 h-4 text-red-500" />}
              {globalStatus === 'partial-error' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
              {globalStatus === 'rolling-back' && <RotateCcw className="w-4 h-4 animate-spin" />}

              <div className="flex-1 font-medium flex justify-between items-center">
                <span>
                  {globalStatus === 'backup' && '正在备份旧文件...'}
                  {globalStatus === 'uploading' && '正在上传文件...'}
                  {globalStatus === 'syncing' && '正在同步数据库...'}
                  {globalStatus === 'success' && '替换成功'}
                  {globalStatus === 'error' && '操作失败'}
                  {globalStatus === 'partial-error' && '部分文件上传失败，请选择后续操作'}
                  {globalStatus === 'rolling-back' && '正在回滚操作，请稍候...'}
                </span>

                {globalStatus === 'partial-error' && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={exportErrorReport} className="h-7 text-xs gap-1">
                      <Download className="w-3 h-3" />
                      导出报告
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Preview List */}
          {previewItems.length > 0 && (
            <div className="border rounded-md overflow-hidden flex flex-col max-h-[400px]">
              <div className="overflow-y-auto flex-1" ref={scrollContainerRef}>
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10">
                    <TableRow>
                      <TableHead className="w-[80px]">Order</TableHead>
                      <TableHead className="w-[60px]">预览</TableHead>
                      <TableHead>原文件名</TableHead>
                      <TableHead>新文件名</TableHead>
                      <TableHead className="w-[180px]">进度</TableHead>
                      <TableHead className="w-[100px]">状态</TableHead>
                      <TableHead className="w-[50px]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewItems.map((item, index) => {
                      const prevItem = previewItems[index - 1]
                      const isGap = prevItem && item.order !== prevItem.order + 1
                      const gapSize = prevItem ? item.order - prevItem.order - 1 : 0

                      return (
                        <Fragment key={item.id}>
                          {isGap && (
                            <TableRow className="bg-orange-50/50 hover:bg-orange-50/50">
                              <TableCell
                                colSpan={7}
                                className="py-2 text-center text-xs text-orange-600 font-medium border-y border-orange-100"
                              >
                                <div className="flex items-center justify-center gap-2">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>
                                    序号中断：缺少 {gapSize} 个文件 (序号 {prevItem.order + 1} - {item.order - 1})
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                          <TableRow
                            id={`row-${item.id}`}
                            className={cn(item.error && 'bg-red-50', item.status === 'uploading' && 'bg-blue-50')}
                          >
                            <TableCell>
                              <Input
                                type="number"
                                value={item.order}
                                onChange={(e) => handleOrderChange(index, parseInt(e.target.value) || 0)}
                                className="h-7 w-16 text-center px-1"
                                disabled={globalStatus !== 'idle'}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="w-10 h-10 rounded overflow-hidden bg-neutral-100 flex items-center justify-center border">
                                {item.previewUrl &&
                                  (VIDEO_EXTENSIONS.includes(
                                    '.' + (item.file.name.split('.').pop() || '').toLowerCase()
                                  ) ? (
                                    <video src={item.previewUrl} className="w-full h-full object-cover" />
                                  ) : (
                                    <img src={item.previewUrl} alt="preview" className="w-full h-full object-cover" />
                                  ))}
                              </div>
                            </TableCell>
                            <TableCell
                              className="font-mono text-xs text-neutral-400 truncate max-w-[150px]"
                              title={item.originalName}
                            >
                              {item.originalName}
                            </TableCell>
                            <TableCell className="max-w-[150px]" title={item.newName}>
                              {(() => {
                                const match = item.newName.match(/^(.*_p)(\d+)(\..*)$/)
                                if (match) {
                                  return (
                                    <div className="font-mono text-xs truncate">
                                      <span className="text-neutral-400">{match[1]}</span>
                                      <span className="text-foreground font-bold text-base mx-0.5">{match[2]}</span>
                                      <span className="text-neutral-400">{match[3]}</span>
                                    </div>
                                  )
                                }
                                return (
                                  <div className="font-mono text-sm font-bold text-foreground truncate">
                                    {item.newName}
                                  </div>
                                )
                              })()}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                  <Progress value={item.progress} className="h-2 w-20" />
                                  <span className="text-[10px] text-muted-foreground">{item.progress}%</span>
                                </div>
                                <span className="text-[10px] text-neutral-400">{formatFileSize(item.size)}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {item.status === 'error' ? (
                                <div className="flex items-center gap-1">
                                  <span className="text-red-500 text-xs flex items-center gap-1">
                                    <XCircle className="w-3 h-3" />
                                    失败
                                  </span>
                                  {globalStatus === 'partial-error' && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-5 w-5"
                                      onClick={() => handleRetrySingle(index)}
                                      title="重试"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                    </Button>
                                  )}
                                </div>
                              ) : item.status === 'success' ? (
                                <span className="text-green-500 text-xs flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3" />
                                  完成
                                </span>
                              ) : item.status === 'uploading' ? (
                                <span className="text-blue-500 text-xs flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  上传中
                                </span>
                              ) : item.error ? (
                                <span className="text-red-500 text-xs flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  冲突
                                </span>
                              ) : (
                                <span className="text-neutral-400 text-xs">等待</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {globalStatus === 'idle' && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-neutral-400 hover:text-red-500"
                                  onClick={() => handleRemoveItem(index)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        </Fragment>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="text-xs text-neutral-500 flex gap-4 items-center">
            <span>待上传: {previewItems.length} 个文件</span>
            <span className="text-neutral-400">
              总大小: {formatFileSize(previewItems.reduce((acc, cur) => acc + cur.size, 0))}
            </span>
          </div>
          <div className="flex gap-2 justify-end">
            {globalStatus === 'partial-error' ? (
              <>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    if (confirm('确定要放弃并回滚所有更改吗？')) {
                      try {
                        await executeRollback()
                        onOpenChange(false)
                        toast.success('已回滚并关闭')
                      } catch (e: any) {
                        toast.error(`回滚失败: ${e.message}`)
                      }
                    }
                  }}
                >
                  取消 (回滚)
                </Button>
                <Button variant="outline" onClick={handleRetryAllFailed} className="gap-1">
                  <RotateCcw className="w-4 h-4" /> 重试失败项
                </Button>
                <Button variant="destructive" onClick={handleIgnoreAndCommit} className="gap-1">
                  <FileWarning className="w-4 h-4" /> 忽略失败并提交
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={
                    globalStatus === 'uploading' || globalStatus === 'syncing' || globalStatus === 'rolling-back'
                  }
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  onClick={startReplace}
                  disabled={
                    previewItems.length === 0 ||
                    globalStatus === 'uploading' ||
                    globalStatus === 'syncing' ||
                    globalStatus === 'rolling-back' ||
                    previewItems.some((i) => i.error)
                  }
                >
                  {globalStatus === 'uploading' ? '上传中...' : '确认全量替换'}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
