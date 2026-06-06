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
import { MEDIA_EXTENSIONS, VIDEO_EXTENSIONS } from '@/lib/constant'
import { extractOrderFromName } from '@/utils/artwork/extract-order-from-name'
import { formatFileSize } from '@/utils/media'
import { guid } from '@/utils/guid'
import { MAX_MEDIA_UPLOAD_SIZE_BYTES, MAX_MEDIA_UPLOAD_SIZE_LABEL } from '@/lib/upload-limits'
import { useThrottleFn } from 'ahooks'
import { useDragDropStore } from '../_store/drag-drop-store'
import { useDragImages } from '../_hooks/use-drag-images'
import { useChunkUpload } from '../_hooks/use-chunk-upload'
import { type ArtworkResponseDto } from '@/schemas/artwork.dto'
import { isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'
import { buildReplaceChapterUploadPlan } from './video-chapter-utils'

interface ImageReplaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artworkId?: number
  artwork: Partial<Pick<ArtworkResponseDto, 'title' | 'externalId' | 'images'>>
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

interface ChapterPreviewItem {
  id: string
  file: File
  originalName: string
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
}

export function ImageReplaceDialog({ open, onOpenChange, artworkId, artwork, onSuccess }: ImageReplaceDialogProps) {
  const [globalStatus, setGlobalStatus] = useState<GlobalUploadStatus>('idle')
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([])
  const [chapterItems, setChapterItems] = useState<ChapterPreviewItem[]>([])
  const [uploadConfig, setUploadConfig] = useState<{ uploadTargetDir: string; targetRelDir: string } | null>(null)
  // Use ref to store uploaded meta to avoid closure staleness issues in async flows
  const uploadedMetaRef = useRef<Record<string, any>>({})
  const uploadedChapterMetaRef = useRef<Record<string, any>>({})
  const previewItemsRef = useRef<PreviewItem[]>([])
  const chapterItemsRef = useRef<ChapterPreviewItem[]>([])
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isCommittingRef = useRef(false)
  const lastScrolledIdRef = useRef<string | null>(null)
  const prevFileCountRef = useRef(0)
  const { uploadSingleFile } = useChunkUpload()

  const updatePreviewItems = (updater: React.SetStateAction<PreviewItem[]>) => {
    const next =
      typeof updater === 'function'
        ? (updater as (value: PreviewItem[]) => PreviewItem[])(previewItemsRef.current)
        : updater

    previewItemsRef.current = next
    setPreviewItems(next)
  }

  const updateChapterItems = (updater: React.SetStateAction<ChapterPreviewItem[]>) => {
    const next =
      typeof updater === 'function'
        ? (updater as (value: ChapterPreviewItem[]) => ChapterPreviewItem[])(chapterItemsRef.current)
        : updater

    chapterItemsRef.current = next
    setChapterItems(next)
  }

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setGlobalStatus('idle')
      updatePreviewItems([])
      updateChapterItems([])
      setUploadConfig(null)
      uploadedMetaRef.current = {}
      uploadedChapterMetaRef.current = {}
      previewItemsRef.current = []
      chapterItemsRef.current = []
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

  const chapterUploadPlan = useMemo(() => {
    return buildReplaceChapterUploadPlan(
      previewItems.map((item) => ({
        id: item.id,
        originalName: item.originalName,
        newName: item.newName
      })),
      chapterItems.map((item) => ({
        id: item.id,
        originalName: item.originalName
      }))
    )
  }, [previewItems, chapterItems])

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

  const { dragHandlers } = useDragImages({
    onDrop: (newFiles) => {
      addFiles(newFiles)
    },
    disabled: globalStatus === 'uploading' || globalStatus === 'syncing' || globalStatus === 'rolling-back'
  })

  const addFiles = (newFiles: File[]) => {
    const mediaFiles = newFiles.filter((f) =>
      MEDIA_EXTENSIONS.includes('.' + (f.name.split('.').pop() || '').toLowerCase())
    )
    const chapterFiles = newFiles.filter((f) => isChapterManifestFileName(f.name))
    const oversizedMediaFiles = mediaFiles.filter((file) => file.size > MAX_MEDIA_UPLOAD_SIZE_BYTES)
    const validMediaFiles = mediaFiles.filter((file) => file.size <= MAX_MEDIA_UPLOAD_SIZE_BYTES)

    if (oversizedMediaFiles.length > 0) {
      toast.error(
        `已拦截 ${oversizedMediaFiles.length} 个超过 ${MAX_MEDIA_UPLOAD_SIZE_LABEL} 的媒体文件：${oversizedMediaFiles
          .slice(0, 3)
          .map((file) => file.name)
          .join('、')}${oversizedMediaFiles.length > 3 ? '...' : ''}`
      )
    }

    if (validMediaFiles.length === 0 && chapterFiles.length === 0) {
      toast.warning('未找到符合格式的媒体或章节文件')
      return
    }

    const newItems = validMediaFiles.map((file) => {
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

    updatePreviewItems((prev) => {
      const combined = [...prev, ...newItems]
      return validateItems(combined)
    })

    if (chapterFiles.length > 0) {
      const newChapterItems = chapterFiles.map((file) => ({
        id: guid(),
        file,
        originalName: file.name,
        status: 'pending' as const,
        progress: 0
      }))
      updateChapterItems((prev) => [...prev, ...newChapterItems])
    }
  }

  // --- Consume Store Files ---
  // Use selectors to prevent unnecessary re-renders
  const fileQueue = useDragDropStore((state) => state.fileQueue)
  const resetQueue = useDragDropStore((state) => state.resetQueue)

  useEffect(() => {
    if (open && fileQueue.length > 0) {
      addFiles(fileQueue)
      resetQueue()
    }
  }, [open, fileQueue, resetQueue, addFiles])

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

    updatePreviewItems(validateItems(newItems))
  }

  const handleRemoveItem = (index: number) => {
    if (!confirm('确定要删除该文件吗？')) return

    updatePreviewItems((prev) => {
      const newItems = [...prev]
      const removed = newItems.splice(index, 1)[0]
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return validateItems(newItems)
    })
  }

  const removeChapterItem = (id: string) => {
    if (!confirm('确定要删除该章节文件吗？')) return
    updateChapterItems((prev) => prev.filter((item) => item.id !== id))
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
    updatePreviewItems([])
    updateChapterItems([])
    setUploadConfig(null)
    uploadedMetaRef.current = {}
    uploadedChapterMetaRef.current = {}
    previewItemsRef.current = []
    chapterItemsRef.current = []
    return true
  }

  const startReplace = async () => {
    if (!artworkId || previewItems.length === 0) return
    if (previewItems.some((i) => i.error)) {
      toast.error('存在序号冲突，请先修正')
      return
    }
    if (chapterUploadPlan.unmatched.length > 0) {
      toast.error(`存在 ${chapterUploadPlan.unmatched.length} 个未匹配章节文件，请先处理`)
      return
    }
    if (chapterUploadPlan.conflicting.length > 0) {
      toast.error(`存在 ${chapterUploadPlan.conflicting.length} 个视频对应多个章节文件，请先处理`)
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
      await processQueue(config)
    } catch (error: any) {
      console.error(error)
      setGlobalStatus('error')
      toast.error(`初始化失败: ${error.message}`)
    }
  }

  const uploadChapterFile = async (input: { artworkId: number; videoPath: string; file: File }) => {
    const formData = new FormData()
    formData.set('artworkId', String(input.artworkId))
    formData.set('videoPath', input.videoPath)
    formData.set('file', input.file)

    const response = await fetch('/api/artwork/media-chapters/upload', {
      method: 'POST',
      body: formData
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || '章节上传失败')
    }

    return data.meta
  }

  const processQueue = async (config: { uploadTargetDir: string; targetRelDir: string }) => {
    const latestPreviewItems = previewItemsRef.current
    const latestChapterItems = chapterItemsRef.current
    const itemsToProcess = latestPreviewItems.filter(
      (item) => (item.status === 'pending' || item.status === 'error') && !uploadedMetaRef.current[item.id]
    )

    if (itemsToProcess.length > 0) {
      const uploadItems = itemsToProcess.map((item) => ({
        id: item.id,
        file: item.file,
        newName: item.newName
      }))

      await uploadLargeFile(uploadItems, config.uploadTargetDir, config.targetRelDir, 3, {
        onStart: (id) => {
          updatePreviewItems((prev) =>
            prev.map((item) =>
              item.id === id ? { ...item, status: 'uploading', progress: 0, error: undefined } : item
            )
          )
        },
        onProgress: (id, percent) => {
          updatePreviewItems((prev) => prev.map((item) => (item.id === id ? { ...item, progress: percent } : item)))
        },
        onSuccess: (id, meta) => {
          uploadedMetaRef.current[id] = meta
          updatePreviewItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, status: 'success', progress: 100 } : item))
          )
        },
        onError: (id, err) => {
          updatePreviewItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, status: 'error', error: err.message } : item))
          )
        }
      })
    }

    const chapterPlansToProcess = chapterUploadPlan.matched.filter((plan) => {
      const chapterItem = latestChapterItems.find((item) => item.id === plan.chapterId)
      return (
        chapterItem &&
        (chapterItem.status === 'pending' || chapterItem.status === 'error') &&
        uploadedMetaRef.current[plan.videoId] &&
        !uploadedChapterMetaRef.current[plan.chapterId]
      )
    })

    if (artworkId && chapterPlansToProcess.length > 0) {
      await runConcurrentTasks(chapterPlansToProcess, 3, async (plan) => {
        const chapterItem = chapterItemsRef.current.find((item) => item.id === plan.chapterId)
        const uploadedVideo = uploadedMetaRef.current[plan.videoId]
        if (!chapterItem || !uploadedVideo?.path) {
          updateChapterItems((prev) =>
            prev.map((item) =>
              item.id === plan.chapterId ? { ...item, status: 'error', error: '章节上传上下文不完整' } : item
            )
          )
          return
        }

        updateChapterItems((prev) =>
          prev.map((item) =>
            item.id === plan.chapterId ? { ...item, status: 'uploading', progress: 0, error: undefined } : item
          )
        )

        try {
          const meta = await uploadChapterFile({
            artworkId,
            videoPath: uploadedVideo.path,
            file: chapterItem.file
          })
          uploadedChapterMetaRef.current[plan.chapterId] = meta
          updateChapterItems((prev) =>
            prev.map((item) => (item.id === plan.chapterId ? { ...item, status: 'success', progress: 100 } : item))
          )
        } catch (error: any) {
          updateChapterItems((prev) =>
            prev.map((item) => (item.id === plan.chapterId ? { ...item, status: 'error', error: error.message } : item))
          )
        }
      })
    }

    checkFinalStatus({
      latestPreviewItems: previewItemsRef.current,
      latestChapterItems: chapterItemsRef.current,
      matchedChapterPlans: chapterUploadPlan.matched
    })
  }

  const checkFinalStatus = (input?: {
    latestPreviewItems?: PreviewItem[]
    latestChapterItems?: ChapterPreviewItem[]
    matchedChapterPlans?: typeof chapterUploadPlan.matched
  }) => {
    const latestPreviewItems = input?.latestPreviewItems || previewItemsRef.current
    const latestChapterItems = input?.latestChapterItems || chapterItemsRef.current
    const matchedChapterPlans = input?.matchedChapterPlans || chapterUploadPlan.matched

    const anyMediaError = latestPreviewItems.some((item) => item.status === 'error')
    const anyChapterError = latestChapterItems.some((item) => item.status === 'error')
    const anyMediaPending = latestPreviewItems.some((item) => item.status === 'pending' || item.status === 'uploading')
    const anyChapterPending = matchedChapterPlans.some((plan) => !uploadedChapterMetaRef.current[plan.chapterId])

    if (anyMediaError || anyChapterError) {
      setGlobalStatus('partial-error')
      return
    }

    if (!anyMediaPending && !anyChapterPending) {
      toast.success('所有文件上传完成，准备提交...')
      setTimeout(() => {
        commitReplace(latestPreviewItems, false)
      }, 250)
      return
    }

    setGlobalStatus('idle')
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
      const chaptersMeta = chapterItemsRef.current
        .filter((item) => (ignoreErrors ? item.status === 'success' : true))
        .map((item) => uploadedChapterMetaRef.current[item.id])
        .filter(Boolean)

      const commitRes = await fetch(`/api/artwork/${artworkId}/replace?action=commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filesMeta: metas, chaptersMeta })
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
    void processQueue(uploadConfig)
  }

  const handleRetrySingle = (index: number) => {
    if (!uploadConfig) return
    updatePreviewItems((prev) => {
      const newItems = [...prev]
      const currentItem = newItems[index]
      if (currentItem) {
        newItems[index] = { ...currentItem, status: 'pending', error: undefined }
      }
      return newItems
    })
    setGlobalStatus('uploading')
    void processQueue(uploadConfig)
  }

  const handleIgnoreAndCommit = () => {
    if (confirm('确定要忽略失败文件并提交吗？失败的文件将不会出现在最终作品中。')) {
      commitReplace(previewItems, true)
    }
  }

  const exportErrorReport = () => {
    const failedItems = previewItems
      .filter((i) => i.status === 'error')
      .map((i) => `File: ${i.originalName}\nError: ${i.error}\nOrder: ${i.order}\n---`)
    const failedChapters = chapterItems
      .filter((i) => i.status === 'error')
      .map((i) => `Chapter: ${i.originalName}\nError: ${i.error}\n---`)
    const unmatchedChapters = chapterUploadPlan.unmatched.map(
      (i) => `Chapter: ${i.originalName}\nError: 未找到对应视频文件\n---`
    )
    const conflictingChapters = chapterUploadPlan.conflicting.map(
      (i) =>
        `Video: ${i.videoOriginalName}\nError: 同一视频匹配多个章节文件 (${i.chapterOriginalNames.join(', ')})\n---`
    )
    const content = [...failedItems, ...failedChapters, ...unmatchedChapters, ...conflictingChapters]
    const blob = new Blob([content.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `upload-errors-${artwork.externalId}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const runConcurrentTasks = async <T,>(items: T[], concurrency: number, task: (item: T) => Promise<void>) => {
    const executing = new Set<Promise<void>>()

    for (const item of items) {
      const promise = task(item).finally(() => {
        executing.delete(promise)
      })
      executing.add(promise)

      if (executing.size >= concurrency) {
        await Promise.race(executing)
      }
    }

    await Promise.all(executing)
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
            {...dragHandlers}
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

          {chapterItems.length > 0 && (
            <div className="border rounded-md p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">章节文件</div>
                  <div className="text-xs text-neutral-500">
                    已匹配 {chapterUploadPlan.matched.length} 个，未匹配 {chapterUploadPlan.unmatched.length} 个，冲突{' '}
                    {chapterUploadPlan.conflicting.length} 个
                  </div>
                </div>
                {(chapterUploadPlan.unmatched.length > 0 || chapterUploadPlan.conflicting.length > 0) && (
                  <span className="text-xs text-red-500">存在未匹配或冲突章节文件，当前不可提交</span>
                )}
              </div>

              <div className="space-y-2 max-h-48 overflow-y-auto">
                {chapterItems.map((item) => {
                  const matchedPlan = chapterUploadPlan.matched.find((plan) => plan.chapterId === item.id)
                  const isUnmatched = !matchedPlan

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'flex items-center justify-between gap-3 rounded border px-3 py-2',
                        isUnmatched && 'border-red-200 bg-red-50/60',
                        item.status === 'error' && 'border-amber-200 bg-amber-50/60'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-mono truncate">{item.originalName}</div>
                        <div className="text-xs text-neutral-500 truncate">
                          {matchedPlan
                            ? `匹配视频: ${matchedPlan.videoOriginalName} -> ${matchedPlan.chapterNewName}`
                            : '未找到对应视频文件'}
                        </div>
                        {item.error && <div className="text-xs text-red-500 truncate">{item.error}</div>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.status === 'uploading' && <Loader2 className="w-3 h-3 animate-spin text-blue-500" />}
                        {item.status === 'success' && <CheckCircle className="w-3 h-3 text-green-500" />}
                        {item.status === 'error' && <XCircle className="w-3 h-3 text-red-500" />}
                        {globalStatus === 'idle' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-neutral-400 hover:text-red-500"
                            onClick={() => removeChapterItem(item.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {chapterUploadPlan.conflicting.length > 0 && (
                <div className="rounded border border-red-200 bg-red-50/60 p-3 space-y-1">
                  {chapterUploadPlan.conflicting.map((conflict) => (
                    <div key={conflict.videoId} className="text-xs text-red-600">
                      {conflict.videoOriginalName}: {conflict.chapterOriginalNames.join(', ')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="text-xs text-neutral-500 flex gap-4 items-center">
            <span>媒体: {previewItems.length} 个</span>
            <span>章节: {chapterItems.length} 个</span>
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
                    previewItems.some((i) => i.error) ||
                    chapterUploadPlan.unmatched.length > 0 ||
                    chapterUploadPlan.conflicting.length > 0
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
