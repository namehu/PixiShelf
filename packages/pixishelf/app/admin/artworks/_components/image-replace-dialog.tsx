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
import type {
  ArtworkMediaApiErrorResponse,
  ImageReplaceInitResponse,
  MediaChapterUploadResponse
} from '@/types/artwork-media-api'
import { confirm as confirmAction } from '@/components/shared/global-confirm'

interface ImageReplaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  artworkId?: number
  artwork: Partial<Pick<ArtworkResponseDto, 'title' | 'externalId' | 'storageKey' | 'images'>>
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
  | 'rolling-back' // 回滚中状态（兼容旧注释风格）

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
  const storageIdentity = artwork.storageKey ?? artwork.externalId ?? `artwork-${artworkId ?? 'unknown'}`
  const [globalStatus, setGlobalStatus] = useState<GlobalUploadStatus>('idle')
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([])
  const [chapterItems, setChapterItems] = useState<ChapterPreviewItem[]>([])
  const [uploadConfig, setUploadConfig] = useState<{ uploadTargetDir: string; targetRelDir: string } | null>(null)
  // 使用 ref 缓存上传元数据，避免异步流程中闭包读取到过期状态
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

  // 对话框打开时重置上传会话状态
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

  // 1. 只在上传进行中计算当前活跃项（低频更新，避免不必要重算）
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

  // 2. 上传中滚动控制（用于突出展示当前上传项）
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
            behavior: isFar ? 'auto' : 'smooth', // 距离过大时改为 instant，减少长距离动画等待
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

    // 触发节流滚动函数，减少快速变更时重复布局
    runThrottledScroll(activeItemId)
  }, [activeItemId, runThrottledScroll])

  // 3. 新增文件时自动滚到列表底部
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
      const newName = `${storageIdentity}_p${order}.${ext}`

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

  // --- 消费拖拽 Store 队列 ---
  // 用选择器读取状态，避免不必要的重复渲染
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
    item.newName = `${storageIdentity}_p${newOrder}.${ext}`

    updatePreviewItems(validateItems(newItems))
  }

  const handleRemoveItem = (index: number) => {
    updatePreviewItems((prev) => {
      const newItems = [...prev]
      const removed = newItems.splice(index, 1)[0]
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      return validateItems(newItems)
    })
  }

  const removeChapterItem = (id: string) => {
    updateChapterItems((prev) => prev.filter((item) => item.id !== id))
  }

  // 客户端回滚执行函数
  const executeRollback = async () => {
    setGlobalStatus('rolling-back')
    const res = await fetch(`/api/artwork/${artworkId}/replace?action=rollback`, { method: 'POST' })
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as Partial<ArtworkMediaApiErrorResponse>
      // 忽略“无可用备份”提示，视为回滚成功
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
        const initData = (await initRes.json()) as ImageReplaceInitResponse | ArtworkMediaApiErrorResponse
        if (!initRes.ok) {
          throw new Error('error' in initData ? initData.error : '初始化备份失败')
        }
        if (!('uploadTargetDir' in initData) || !initData.uploadTargetDir || !initData.targetRelDir) {
          throw new Error('初始化备份失败')
        }

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

    const data = (await response.json().catch(() => ({}))) as Partial<
      MediaChapterUploadResponse & ArtworkMediaApiErrorResponse
    >
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
        // [新增] 若后端返回 400 重复错误，可在此处扩展处理
        const errorData = (await commitRes.json()) as ArtworkMediaApiErrorResponse
        throw new Error(errorData.error || '数据库同步失败')
      }

      setGlobalStatus('success')
      toast.success('替换完成')
      onSuccess?.()
      onOpenChange(false)
    } catch (error: any) {
      console.error(error)
      // 提交失败触发自动回滚
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
    confirmAction({
      title: '忽略失败文件并提交？',
      description: '失败的媒体不会出现在最终作品中；成功上传的媒体会替换当前作品内容。',
      confirmText: '忽略并提交',
      variant: 'destructive',
      onConfirm: () => commitReplace(previewItems, true)
    })
  }

  const handleRollbackAndClose = () => {
    confirmAction({
      title: '放弃更改并回滚？',
      description: '本次替换已上传的内容会被撤销，并恢复操作前的媒体。',
      confirmText: '确认回滚',
      variant: 'destructive',
      onConfirm: async () => {
        try {
          await executeRollback()
          onOpenChange(false)
          toast.success('已回滚并关闭')
        } catch (error) {
          const message = error instanceof Error ? error.message : '未知错误'
          toast.error(`回滚失败: ${message}`)
          throw error
        }
      }
    })
  }

  const handleStartReplace = () => {
    confirmAction({
      title: '替换当前作品的全部媒体？',
      description: `将使用列表中的 ${previewItems.length} 个媒体替换当前内容；系统会先创建可回滚备份。`,
      confirmText: '开始替换',
      variant: 'destructive',
      onConfirm: startReplace
    })
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
    a.download = `upload-errors-${storageIdentity}.txt`
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
   * 并发上传文件（限制并发数以平衡速度与后台压力）
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
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>全量替换 - {artwork.title || storageIdentity}</DialogTitle>
          <DialogDescription>将会清空当前作品的所有图片，并替换为上传的新文件。支持拖拽文件夹。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-1">
          {/* 文件选择 */}
          <div
            className={cn(
              'relative rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors',
              globalStatus === 'uploading' || globalStatus === 'syncing' || globalStatus === 'rolling-back'
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer hover:bg-muted/50'
            )}
            {...dragHandlers}
          >
            <input
              name="replacement-media-files"
              aria-label="选择用于全量替换的媒体与章节文件"
              type="file"
              multiple
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              onChange={handleFileSelect}
              disabled={globalStatus === 'uploading' || globalStatus === 'syncing' || globalStatus === 'rolling-back'}
            />
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <FolderInput className="size-8" aria-hidden="true" />
              <p className="text-sm font-medium">点击选择 / 拖拽文件夹或文件</p>
              <p className="text-xs text-muted-foreground">支持批量选择，自动解析排序序号</p>
            </div>
          </div>

          {/* 全局状态 */}
          {globalStatus !== 'idle' && (
            <div
              className={cn(
                'flex items-center gap-2 text-sm p-3 rounded border',
                globalStatus === 'partial-error' ? 'border-warning/20 bg-warning/10' : 'bg-muted'
              )}
            >
              {globalStatus === 'backup' && <Loader2 className="w-4 h-4 animate-spin" />}
              {globalStatus === 'uploading' && <Loader2 className="w-4 h-4 animate-spin" />}
              {globalStatus === 'syncing' && <RefreshCw className="w-4 h-4 animate-spin" />}
              {globalStatus === 'success' && <CheckCircle className="size-4 text-success" />}
              {globalStatus === 'error' && <XCircle className="size-4 text-destructive" />}
              {globalStatus === 'partial-error' && <AlertTriangle className="size-4 text-warning-foreground" />}
              {globalStatus === 'rolling-back' && <RotateCcw className="w-4 h-4 animate-spin" />}

              <div className="flex-1 font-medium flex justify-between items-center">
                <span>
                  {globalStatus === 'backup' && '正在备份旧文件…'}
                  {globalStatus === 'uploading' && '正在上传文件…'}
                  {globalStatus === 'syncing' && '正在同步数据库…'}
                  {globalStatus === 'success' && '替换成功'}
                  {globalStatus === 'error' && '操作失败'}
                  {globalStatus === 'partial-error' && '部分文件上传失败，请选择后续操作'}
                  {globalStatus === 'rolling-back' && '正在回滚操作，请稍候…'}
                </span>

                {globalStatus === 'partial-error' && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={exportErrorReport} className="h-7 text-xs gap-1">
                      <Download data-icon="inline-start" aria-hidden="true" />
                      导出报告
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 预览列表 */}
          {previewItems.length > 0 && (
            <div className="border rounded-md overflow-hidden flex flex-col max-h-[400px]">
              <div className="overflow-y-auto flex-1" ref={scrollContainerRef}>
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
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
                            <TableRow className="bg-warning/5 hover:bg-warning/5">
                              <TableCell
                                colSpan={7}
                                className="border-y border-warning/15 py-2 text-center text-xs font-medium text-warning-foreground"
                              >
                                <div className="flex items-center justify-center gap-2">
                                  <AlertTriangle className="size-3" aria-hidden="true" />
                                  <span>
                                    序号中断：缺少 {gapSize} 个文件 (序号 {prevItem.order + 1} - {item.order - 1})
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                          <TableRow
                            id={`row-${item.id}`}
                            className={cn(item.error && 'bg-destructive/5', item.status === 'uploading' && 'bg-primary/5')}
                          >
                            <TableCell>
                            <Input
                              name={`media-order-${item.id}`}
                              aria-label={`调整 ${item.originalName} 的排序`}
                              type="number"
                                value={item.order}
                                onChange={(e) => handleOrderChange(index, parseInt(e.target.value) || 0)}
                                className="h-7 w-16 text-center px-1"
                                disabled={globalStatus !== 'idle'}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex size-10 items-center justify-center overflow-hidden rounded border bg-muted">
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
                              className="max-w-[150px] truncate font-mono text-xs text-muted-foreground"
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
                                      <span className="text-muted-foreground">{match[1]}</span>
                                      <span className="text-foreground font-bold text-base mx-0.5">{match[2]}</span>
                                      <span className="text-muted-foreground">{match[3]}</span>
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
                                <span className="text-[10px] text-muted-foreground">{formatFileSize(item.size)}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {item.status === 'error' ? (
                                <div className="flex items-center gap-1">
                                  <span className="flex items-center gap-1 text-xs text-destructive">
                                    <XCircle className="w-3 h-3" />
                                    失败
                                  </span>
                                  {globalStatus === 'partial-error' && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-5 w-5"
                                      onClick={() => handleRetrySingle(index)}
                                      aria-label={`重试上传 ${item.originalName}`}
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                    </Button>
                                  )}
                                </div>
                              ) : item.status === 'success' ? (
                                <span className="flex items-center gap-1 text-xs text-success">
                                  <CheckCircle className="w-3 h-3" />
                                  完成
                                </span>
                              ) : item.status === 'uploading' ? (
                                <span className="flex items-center gap-1 text-xs text-primary">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  上传中
                                </span>
                              ) : item.error ? (
                                <span className="flex items-center gap-1 text-xs text-destructive">
                                  <AlertTriangle className="w-3 h-3" />
                                  冲突
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">等待</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {globalStatus === 'idle' && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="size-6 text-muted-foreground hover:text-destructive"
                                  onClick={() => handleRemoveItem(index)}
                                  aria-label={`从替换列表移除 ${item.originalName}`}
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
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">章节文件</div>
                  <div className="text-xs text-muted-foreground">
                    已匹配 {chapterUploadPlan.matched.length} 个，未匹配 {chapterUploadPlan.unmatched.length} 个，冲突{' '}
                    {chapterUploadPlan.conflicting.length} 个
                  </div>
                </div>
                {(chapterUploadPlan.unmatched.length > 0 || chapterUploadPlan.conflicting.length > 0) && (
                  <span className="text-xs text-destructive">存在未匹配或冲突章节文件，当前不可提交</span>
                )}
              </div>

              <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
                {chapterItems.map((item) => {
                  const matchedPlan = chapterUploadPlan.matched.find((plan) => plan.chapterId === item.id)
                  const isUnmatched = !matchedPlan

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'flex items-center justify-between gap-3 rounded border px-3 py-2',
                        isUnmatched && 'border-destructive/20 bg-destructive/5',
                        item.status === 'error' && 'border-warning/20 bg-warning/5'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-mono truncate">{item.originalName}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {matchedPlan
                            ? `匹配视频: ${matchedPlan.videoOriginalName} -> ${matchedPlan.chapterNewName}`
                            : '未找到对应视频文件'}
                        </div>
                        {item.error && <div className="truncate text-xs text-destructive">{item.error}</div>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {item.status === 'uploading' && <Loader2 className="size-3 animate-spin text-primary" />}
                        {item.status === 'success' && <CheckCircle className="size-3 text-success" />}
                        {item.status === 'error' && <XCircle className="size-3 text-destructive" />}
                        {globalStatus === 'idle' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-6 text-muted-foreground hover:text-destructive"
                            onClick={() => removeChapterItem(item.id)}
                            aria-label={`从替换列表移除章节文件 ${item.originalName}`}
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
                <div className="flex flex-col gap-1 rounded border border-destructive/20 bg-destructive/10 p-3">
                  {chapterUploadPlan.conflicting.map((conflict) => (
                    <div key={conflict.videoId} className="text-xs text-destructive">
                      {conflict.videoOriginalName}: {conflict.chapterOriginalNames.join(', ')}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>媒体: {previewItems.length} 个</span>
            <span>章节: {chapterItems.length} 个</span>
            <span className="text-muted-foreground">
              总大小: {formatFileSize(previewItems.reduce((acc, cur) => acc + cur.size, 0))}
            </span>
          </div>
          <div className="flex gap-2 justify-end">
            {globalStatus === 'partial-error' ? (
              <>
                <Button
                  variant="ghost"
                  onClick={handleRollbackAndClose}
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
                  onClick={handleStartReplace}
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
                  {globalStatus === 'uploading' ? '上传中…' : '确认全量替换'}
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
