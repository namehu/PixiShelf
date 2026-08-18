'use client'

import { useCallback, useRef, useState } from 'react'
import { useTRPCClient } from '@/lib/trpc'
import type { ArtworkResponseDto } from '@/schemas/artwork.dto'
import type { ArtworkMediaApiErrorResponse, MediaChapterUploadResponse } from '@/types/artwork-media-api'
import { toast } from 'sonner'
import type { ImageListItem } from '../_components/types'
import { getNextImageSortOrder } from '../_components/image-manager/utils'
import { useDragDropStore } from '../_store/drag-drop-store'
import { useChunkUpload } from './use-chunk-upload'
import { useDragImages } from './use-drag-images'

type ArtworkMediaUploadData = Partial<Pick<ArtworkResponseDto, 'id' | 'title' | 'externalId' | 'storageKey' | 'images'>>

interface UseArtworkMediaUploadOptions {
  artwork: ArtworkMediaUploadData
  imageList: ImageListItem[]
  onSuccess?: () => void
}

/**
 * 将媒体章节文件上传到服务端，用于绑定/替换图片对应的章节元数据。
 * 调用者需保证该文件是已有视频路径对应的章节文件（`videoPath` 为数据库路径）。
 */
export async function uploadArtworkMediaChapter(input: {
  artworkId: number
  imageId: number
  videoPath: string
  file: File
}) {
  const formData = new FormData()
  formData.set('artworkId', String(input.artworkId))
  formData.set('imageId', String(input.imageId))
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

/**
 * 统一封装“作品媒体上传/替换”交互：
 * - 在同一个拖拽区域内识别左/右半区语义；
 * - 串联已有添加弹窗、替换弹窗和上传进度状态；
 * - 作为列表管理与行内预览的共享入口，避免重复实现同一业务流。
 */
export function useArtworkMediaUpload({ artwork, imageList, onSuccess }: UseArtworkMediaUploadOptions) {
  const artworkId = artwork.id
  const trpcClient = useTRPCClient()
  const { uploadSingleFile } = useChunkUpload()
  const addFilesToQueue = useDragDropStore((state) => state.addFilesToQueue)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showReplaceDialog, setShowReplaceDialog] = useState(false)
  const [defaultAddOrder, setDefaultAddOrder] = useState(0)
  const [addInitialFile, setAddInitialFile] = useState<File | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [addProgress, setAddProgress] = useState(0)
  const [dragZone, setDragZone] = useState<'add' | 'replace' | null>(null)
  // 双 ref 用于“高频拖拽路径”：dragZoneRef 同步当前 hover 分区，capturedZoneRef 绑定本次 drop 的分区快照。
  const dragZoneRef = useRef<'add' | 'replace' | null>(null)
  const capturedZoneRef = useRef<'add' | 'replace' | null>(null)

  const openAddDialog = useCallback(
    (initialFile: File | null = null) => {
      setAddInitialFile(initialFile)
      setDefaultAddOrder(getNextImageSortOrder(imageList))
      setShowAddDialog(true)
    },
    [imageList]
  )

  const openReplaceDialog = useCallback(() => {
    setShowReplaceDialog(true)
  }, [])

  const handleAddSubmit = useCallback(
    async (file: File, order: number, chapterFile?: File | null) => {
      if (!artworkId) return

      try {
        setIsAdding(true)
        setAddProgress(0)

        const { targetDir, targetRelDir } = await trpcClient.artwork.getUploadPath.query(artworkId)
        const ext = file.name.split('.').pop() || ''
        const storageIdentity = artwork.storageKey ?? artwork.externalId ?? `artwork-${artworkId}`
        const fileName = `${storageIdentity}_p${order}.${ext}`

        const meta = await uploadSingleFile(file, fileName, targetDir, targetRelDir, (progress) => {
          setAddProgress(progress)
        })

        if (!meta) {
          throw new Error('Upload failed: No metadata returned')
        }

        const createdImage = await trpcClient.artwork.addImage.mutate({
          artworkId,
          file: {
            fileName: meta.fileName,
            order,
            width: meta.width,
            height: meta.height,
            size: meta.size,
            path: meta.path
          }
        })

        let chapterWarning = ''
        if (chapterFile) {
          try {
            await uploadArtworkMediaChapter({
              artworkId,
              imageId: createdImage.id,
              videoPath: meta.path,
              file: chapterFile
            })
          } catch (error) {
            chapterWarning = error instanceof Error ? error.message : '章节上传失败'
          }
        }

        toast.success(chapterWarning ? `媒体已添加，章节关联失败：${chapterWarning}` : '媒体添加成功')
        setShowAddDialog(false)
        onSuccess?.()
      } catch (error) {
        console.error('Add image failed:', error)
        toast.error(`添加失败: ${error instanceof Error ? error.message : '未知错误'}`)
      } finally {
        setIsAdding(false)
      }
    },
    [artwork.externalId, artwork.storageKey, artworkId, onSuccess, trpcClient, uploadSingleFile]
  )

  const updateDragZone = useCallback((zone: 'add' | 'replace' | null) => {
    setDragZone(zone)
    dragZoneRef.current = zone
  }, [])

  const { isDragging, dragHandlers } = useDragImages({
    onDrop: (files) => {
      // 进入此回调时已完成文件系统扫描；此处只负责“分区路由”。
      // 左侧仅取第一份文件作为“新增”语义，右侧将全部文件入队触发“全量替换”。
      const currentZone = capturedZoneRef.current
      if (currentZone === 'add') {
        if (files.length > 0) openAddDialog(files[0]!)
      } else {
        addFilesToQueue(files)
        openReplaceDialog()
      }
      updateDragZone(null)
      capturedZoneRef.current = null
    },
    onDragStateChange: (dragging) => {
      // 拖拽离开或结束时清空视觉分区，避免跨一次拖拽残留高亮。
      if (!dragging) updateDragZone(null)
    }
  })

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      dragHandlers.onDragOver(event)
      const rect = event.currentTarget.getBoundingClientRect()
      // 以容器中心分割拖拽落点，左侧=新增、右侧=替换；
      // 该判断只影响覆盖层显示与后续 onDrop 分支，不参与文件校验。
      const zone = event.clientX - rect.left < rect.width / 2 ? 'add' : 'replace'
      if (dragZoneRef.current !== zone) updateDragZone(zone)
    },
    [dragHandlers, updateDragZone]
  )

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const rect = event.currentTarget.getBoundingClientRect()
      // 先锁定本次放下落点到 capturedZoneRef，供内部 useDragImages 的异步 onDrop 回调使用。
      capturedZoneRef.current = event.clientX - rect.left < rect.width / 2 ? 'add' : 'replace'
      await dragHandlers.onDrop(event)
    },
    [dragHandlers]
  )

  return {
    isDragging,
    dragZone,
    dragHandlers: {
      ...dragHandlers,
      onDragOver: handleDragOver,
      onDrop: handleDrop
    },
    openAddDialog,
    openReplaceDialog,
    addDialog: {
      open: showAddDialog,
      onOpenChange: setShowAddDialog,
      onSubmit: handleAddSubmit,
      isSubmitting: isAdding,
      progress: addProgress,
      defaultOrder: defaultAddOrder,
      initialFile: addInitialFile
    },
    replaceDialog: {
      open: showReplaceDialog,
      onOpenChange: setShowReplaceDialog,
      artworkId,
      artwork,
      onSuccess
    }
  }
}
