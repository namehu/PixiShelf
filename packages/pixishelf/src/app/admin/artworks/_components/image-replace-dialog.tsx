import { useState, useEffect, useRef, Fragment } from 'react'
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
  Play,
  RotateCcw,
  FileWarning,
  ArrowRight,
  Download
} from 'lucide-react'
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

type GlobalUploadStatus = 'idle' | 'backup' | 'uploading' | 'syncing' | 'success' | 'error' | 'partial-error'

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

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setGlobalStatus('idle')
      setFiles([])
      setPreviewItems([])
      setUploadConfig(null)
      uploadedMetaRef.current = {}
      isCommittingRef.current = false
    }
  }, [open])

  // Auto-scroll to uploading item
  useEffect(() => {
    if (globalStatus === 'uploading') {
      const uploadingIndex = previewItems.findIndex((item) => item.status === 'uploading')
      if (uploadingIndex !== -1) {
        scrollToItem(uploadingIndex)
      }
    }
  }, [previewItems, globalStatus])

  const scrollToItem = (index: number) => {
    const row = document.getElementById(`file-row-${index}`)
    if (row && scrollContainerRef.current) {
      const container = scrollContainerRef.current
      const rowRect = row.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      if (rowRect.top < containerRect.top || rowRect.bottom > containerRect.bottom) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }

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
    const validFiles = newFiles.filter((f) => MEDIA_EXTENSIONS.includes('.' + (f.name.split('.').pop() || '')))
    if (validFiles.length === 0) {
      toast.warning('未找到符合格式的图片文件')
      return
    }

    setFiles((prev) => [...prev, ...validFiles])

    const newItems = validFiles.map((file) => {
      const order = extractOrderFromName(file.name)
      const ext = file.name.split('.').pop()
      const newName = `${artwork.externalId}_p${order}.${ext}`

      return {
        id: Math.random().toString(36).substring(7),
        file,
        originalName: file.name,
        newName,
        order,
        size: file.size,
        status: 'pending' as const,
        progress: 0
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
    const itemsToProcess = previewItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === 'pending' || item.status === 'error')

    for (const { item, index } of itemsToProcess) {
      if (uploadedMetaRef.current[item.id]) continue

      // Update status to uploading
      setPreviewItems((prev) => {
        const newItems = [...prev]
        const currentItem = newItems[index]
        if (currentItem) {
          newItems[index] = { ...currentItem, status: 'uploading', progress: 0, error: undefined }
        }
        return newItems
      })

      try {
        const meta = await uploadLargeFile(
          item.file,
          item.newName,
          config.uploadTargetDir,
          config.targetRelDir,
          (percent) => {
            setPreviewItems((prev) => {
              const newItems = [...prev]
              const currentItem = newItems[index]
              if (currentItem) {
                newItems[index] = { ...currentItem, progress: percent }
              }
              return newItems
            })
          }
        )

        uploadedMetaRef.current[item.id] = meta

        setPreviewItems((prev) => {
          const newItems = [...prev]
          const currentItem = newItems[index]
          if (currentItem) {
            newItems[index] = { ...currentItem, status: 'success', progress: 100 }
          }
          return newItems
        })
      } catch (err: any) {
        setPreviewItems((prev) => {
          const newItems = [...prev]
          const currentItem = newItems[index]
          if (currentItem) {
            newItems[index] = { ...currentItem, status: 'error', error: err.message }
          }
          return newItems
        })
      }
    }

    // Check final status
    setPreviewItems((currentItems) => {
      const anyError = currentItems.some((i) => i.status === 'error')
      const anyPending = currentItems.some((i) => i.status === 'pending')

      if (anyError) {
        setGlobalStatus('partial-error')
      } else if (!anyPending) {
        // All done, trigger commit automatically
        // Use setTimeout to move side effect out of updater function
        setTimeout(() => {
          commitReplace(currentItems)
        }, 0)
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
      setGlobalStatus('error')
      toast.error(`提交失败: ${error.message}`)
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

  // Design Decisions:
  // 1. Continuity Check: Detects gaps in the file sequence (e.g., 1, 3) and inserts a visual warning row to alert the user.
  // 2. Visual Hierarchy: Emphasizes the 'New Filename' (bold, dark) over 'Original Filename' (muted, small) to focus on the final state.
  // 3. Layout Optimization: Moves statistics to the footer to declutter the list view and group status info with actions.
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
          <DialogDescription>将会清空当前作品的所有图片，并替换为上传的新文件。支持拖拽文件夹。</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-1 space-y-4">
          {/* File Selection */}
          <div
            className={cn(
              'border-2 border-dashed border-neutral-200 rounded-lg p-6 text-center transition-colors relative',
              globalStatus === 'uploading' || globalStatus === 'syncing'
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
              disabled={globalStatus === 'uploading' || globalStatus === 'syncing'}
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

              <div className="flex-1 font-medium flex justify-between items-center">
                <span>
                  {globalStatus === 'backup' && '正在备份旧文件...'}
                  {globalStatus === 'uploading' && '正在上传文件...'}
                  {globalStatus === 'syncing' && '正在同步数据库...'}
                  {globalStatus === 'success' && '替换成功'}
                  {globalStatus === 'error' && '操作失败'}
                  {globalStatus === 'partial-error' && '部分文件上传失败，请选择后续操作'}
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
                      <TableHead>原文件名</TableHead>
                      <TableHead>新文件名</TableHead>
                      <TableHead className="w-[180px]">进度</TableHead>
                      <TableHead className="w-[100px]">状态</TableHead>
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
                                colSpan={5}
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
                            id={`file-row-${index}`}
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
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
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
                  disabled={globalStatus === 'uploading' || globalStatus === 'syncing'}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  onClick={startReplace}
                  disabled={
                    files.length === 0 ||
                    globalStatus === 'uploading' ||
                    globalStatus === 'syncing' ||
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
