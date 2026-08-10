'use client'

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { ProTable } from '@/components/shared/pro-table'
import { combinationApiResource } from '@/utils/combination-static'
import { ProDialog } from '@/components/shared/pro-dialog'
import { confirm } from '@/components/shared/global-confirm'
import { ImageReplaceDialog } from '../image-replace-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useChunkUpload } from '../../_hooks/use-chunk-upload'
import { toast } from 'sonner'
import { useDragDropStore } from '../../_store/drag-drop-store'
import { useDragImages } from '../../_hooks/use-drag-images'
import { HoverPreview } from '../hover-preview'
import { ImagePreviewDialog } from '../image-preview-dialog'
import { AddImageDialog } from '../add-image-dialog'
import { ImageListItem } from '../types'
import type { Option } from '@/components/shared/multiple-selector'
import { useRecentTags } from '@/store/admin/use-recent-tags'
import { ImageChapterDialog } from '../image-chapter-dialog'
import { MediaVideoMetadataDialog } from '../media-video-metadata-dialog'
import { getFirstImageDirectory, getImageManagerStats, getNextImageSortOrder, isVideoImageListItem } from './utils'
import { createImageManagerColumns } from './columns'
import { ImageManagerTagPanel } from './tag-panel'
import { ImageManagerToolbar } from './toolbar'
import { ImageManagerDragOverlay } from './drag-overlay'
import { ImageManagerThumbnailList } from './thumbnail-list'
import { isActiveVideoOptimization, type VideoOptimizationJob } from './video-optimization'
import type { ArtworkMediaApiErrorResponse, MediaChapterUploadResponse } from '@/types/artwork-media-api'

interface ImageManagerContentProps {
  data: any
  onSuccess?: () => void
}

export function ImageManagerContent({ data, onSuccess }: ImageManagerContentProps) {
  const artwork = data || {}
  const artworkId = artwork.id
  const imageList = (artwork.images || []) as unknown as ImageListItem[]

  const trpcClient = useTRPCClient()
  const trpc = useTRPC()
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

  const refreshMediaList = useCallback(() => {
    setRefreshKey((k) => k + 1)
    onSuccess?.()
  }, [onSuccess])

  const videoImageIds = useMemo(
    () => imageList.filter(isVideoImageListItem).map((image) => image.id),
    [artwork.images]
  )
  const [optimizationPollInterval, setOptimizationPollInterval] = useState<number | false>(false)
  const [startingVideoOptimizationImageId, setStartingVideoOptimizationImageId] = useState<number | null>(null)
  const startedOptimizationJobIdsRef = useRef(new Set<string>())
  const optimizationStatusQuery = useQuery(
    trpc.job.getVideoStreamingOptimizationStatuses.queryOptions(
      { imageIds: videoImageIds },
      {
        enabled: videoImageIds.length > 0,
        refetchInterval: optimizationPollInterval
      }
    )
  )
  const videoOptimizationJobs = (optimizationStatusQuery.data || []) as VideoOptimizationJob[]
  const videoOptimizationJobsByImageId = useMemo(
    () =>
      Object.fromEntries(
        videoOptimizationJobs
          .filter((job) => job.targetImageId !== null && job.targetImageId !== undefined)
          .map((job) => [job.targetImageId!, job])
      ) as Record<number, VideoOptimizationJob | undefined>,
    [videoOptimizationJobs]
  )

  useEffect(() => {
    setOptimizationPollInterval(videoOptimizationJobs.some(isActiveVideoOptimization) ? 1000 : false)
  }, [videoOptimizationJobs])

  useEffect(() => {
    let shouldRefresh = false
    for (const job of videoOptimizationJobs) {
      if (!startedOptimizationJobIdsRef.current.has(job.id) || isActiveVideoOptimization(job)) continue
      startedOptimizationJobIdsRef.current.delete(job.id)
      shouldRefresh = true
      if (job.status === 'COMPLETED') toast.success('MP4 无损播放优化完成')
      if (job.status === 'FAILED') toast.error(`MP4 无损播放优化失败: ${job.error || '未知错误'}`)
      if (job.status === 'CANCELLED') toast.info('MP4 无损播放优化已取消，原视频未替换')
    }
    if (shouldRefresh) refreshMediaList()
  }, [refreshMediaList, videoOptimizationJobs])

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
  const [chapterDialogTarget, setChapterDialogTarget] = useState<ImageListItem | null>(null)
  const [chapterDialogMode, setChapterDialogMode] = useState<'upload' | 'replace'>('upload')
  const [isSubmittingChapter, setIsSubmittingChapter] = useState(false)
  const [deleteChapterTarget, setDeleteChapterTarget] = useState<ImageListItem | null>(null)
  const [deleteChapterPhysical, setDeleteChapterPhysical] = useState(false)
  const [videoMetadataTarget, setVideoMetadataTarget] = useState<ImageListItem | null>(null)
  const [reprobingImageId, setReprobingImageId] = useState<number | null>(null)

  const uploadChapterFile = async (input: { artworkId: number; imageId: number; videoPath: string; file: File }) => {
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

  const handleAddSubmit = async (file: File, order: number, chapterFile?: File | null) => {
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

      const createdImage = await trpcClient.artwork.addImage.mutate({
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

      let chapterWarning = ''
      if (chapterFile) {
        try {
          await uploadChapterFile({
            artworkId,
            imageId: createdImage.id,
            videoPath: meta.path,
            file: chapterFile
          })
        } catch (error: any) {
          chapterWarning = error.message || '章节上传失败'
        }
      }

      toast.success(chapterWarning ? `媒体已添加，章节关联失败：${chapterWarning}` : '媒体添加成功')
      setShowAddDialog(false)
      refreshMediaList()
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
      refreshMediaList()
    } catch (error) {
      toast.error('删除失败')
      console.error(error)
    }
  }

  // --- Hover Preview Logic ---
  const [hoverImage, setHoverImage] = useState<ImageListItem | null>(null)
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 })
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null)

  const handleMouseEnter = useCallback((image: ImageListItem, e: React.MouseEvent) => {
    const { clientX, clientY } = e
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      setHoverImage(image)
      setHoverPos({ x: clientX, y: clientY })
    }, 150)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    setHoverImage(null)
  }, [])

  const downloadBlobByUrl = useCallback(async (url: string, fileName: string) => {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error('网络请求失败')
    }

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
  }, [])

  // --- Download Media Logic ---
  const handleDownload = useCallback(
    async (path: string) => {
      try {
        const url = combinationApiResource(path)
        if (!url) throw new Error('无效的媒体路径')

        const fileName = path.split('/').pop() || 'media'
        await downloadBlobByUrl(url, fileName)
      } catch (error: any) {
        console.error('Download failed:', error)
        toast.error(`下载失败: ${error.message}`)
      }
    },
    [downloadBlobByUrl]
  )

  const handleDownloadChapters = useCallback(
    async (image: ImageListItem) => {
      try {
        if (!image.chaptersUrl) {
          throw new Error('当前媒体没有可下载的章节文件')
        }

        const fileName =
          image.chaptersPath?.split('/').pop() || `${image.path.split('/').pop() || 'video'}.chapters.json`
        await downloadBlobByUrl(image.chaptersUrl, fileName)
      } catch (error: any) {
        console.error('Download chapters failed:', error)
        toast.error(`章节下载失败: ${error.message}`)
      }
    },
    [downloadBlobByUrl]
  )

  const handleChapterSubmit = async (file: File) => {
    if (!artworkId || !chapterDialogTarget) return

    try {
      setIsSubmittingChapter(true)
      await uploadChapterFile({
        artworkId,
        imageId: chapterDialogTarget.id,
        videoPath: chapterDialogTarget.path,
        file
      })

      toast.success(chapterDialogMode === 'replace' ? '章节替换成功' : '章节上传成功')
      setChapterDialogTarget(null)
      refreshMediaList()
    } catch (error: any) {
      console.error('Submit chapter failed:', error)
      toast.error(`${chapterDialogMode === 'replace' ? '章节替换' : '章节上传'}失败: ${error.message}`)
    } finally {
      setIsSubmittingChapter(false)
    }
  }

  const handleDeleteChapter = async () => {
    if (!deleteChapterTarget) return

    try {
      const response = await fetch(`/api/artwork/media-chapters/${deleteChapterTarget.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          deleteFile: deleteChapterPhysical
        })
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || '删除章节失败')
      }

      toast.success('章节删除成功')
      setDeleteChapterTarget(null)
      setDeleteChapterPhysical(false)
      refreshMediaList()
    } catch (error: any) {
      console.error('Delete chapter failed:', error)
      toast.error(`章节删除失败: ${error.message}`)
    }
  }

  const openChapterDialog = (image: ImageListItem, mode: 'upload' | 'replace') => {
    setChapterDialogMode(mode)
    setChapterDialogTarget(image)
  }

  const handleReprobeVideo = async (image: ImageListItem) => {
    try {
      setReprobingImageId(image.id)
      const result = await trpcClient.artwork.reprobeVideoMedia.mutate({ imageId: image.id })
      toast.success(`视频重新探测完成：${result.hasAudio ? '有音频' : '无音频'}`)
      refreshMediaList()
    } catch (error: any) {
      toast.error(`重新探测失败: ${error.message}`)
    } finally {
      setReprobingImageId(null)
    }
  }

  const handleStartVideoOptimization = (image: ImageListItem) => {
    if (!image.path.toLowerCase().endsWith('.mp4')) {
      toast.info('第一阶段仅支持 MP4 无损重新封装；其他格式需要使用后续的视频转码功能')
      return
    }

    confirm({
      title: '确认执行 MP4 无损播放优化？',
      description: (
        <div className="mt-2 space-y-2 text-sm">
          <p className="break-all font-mono text-xs">{image.path}</p>
          <p>将使用 FFmpeg stream copy + faststart 移动 moov 并重建容器索引，视频和音频不会重新编码。</p>
          <p>此操作不会增加关键帧；如果视频本身关键帧稀疏，仍需使用后续的兼容转码功能。</p>
          <p className="text-amber-600">成功后会原位替换文件。执行期间请勿从外部修改或移动该视频。</p>
        </div>
      ),
      confirmText: '开始无损优化',
      onConfirm: async () => {
        setStartingVideoOptimizationImageId(image.id)
        try {
          const result = await trpcClient.job.startVideoStreamingOptimization.mutate({ imageId: image.id })
          startedOptimizationJobIdsRef.current.add(result.jobId)
          setOptimizationPollInterval(1000)
          await optimizationStatusQuery.refetch()
          toast.success('任务已启动，进度会直接显示在当前媒体行')
        } catch (error) {
          toast.error(`启动优化失败: ${error instanceof Error ? error.message : '未知错误'}`)
        } finally {
          setStartingVideoOptimizationImageId(null)
        }
      }
    })
  }

  const handleCancelVideoOptimization = async (job: VideoOptimizationJob) => {
    try {
      const result = await trpcClient.job.cancelVideoStreamingOptimization.mutate({ jobId: job.id })
      if (result.success) {
        toast.info('正在取消 MP4 无损播放优化...')
        setOptimizationPollInterval(1000)
        await optimizationStatusQuery.refetch()
      } else {
        toast.info('该任务已经结束')
      }
    } catch (error) {
      toast.error(`取消优化失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

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

  const columns = createImageManagerColumns({
    reprobingImageId,
    onClearHover: () => setHoverImage(null),
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onOpenVideoMetadata: setVideoMetadataTarget,
    onDownload: (path) => {
      void handleDownload(path)
    },
    onOpenChapterDialog: openChapterDialog,
    onDownloadChapters: (image) => {
      void handleDownloadChapters(image)
    },
    onDeleteChapter: setDeleteChapterTarget,
    onReprobeVideo: (image) => {
      void handleReprobeVideo(image)
    },
    videoOptimizationJobsByImageId,
    startingVideoOptimizationImageId,
    onStartVideoOptimization: handleStartVideoOptimization,
    onCancelVideoOptimization: (job) => {
      void handleCancelVideoOptimization(job)
    },
    onDelete: setDeleteTarget
  })

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
          setDefaultAddOrder(getNextImageSortOrder(imageList))
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

  const firstImagePath = useMemo(() => getFirstImageDirectory(artwork), [artwork])
  const mediaStats = useMemo(() => getImageManagerStats(imageList), [imageList])

  return (
    <div className="flex flex-col h-full gap-4">
      <ImageManagerTagPanel
        isSavingTags={isSavingTags}
        selectedTagOptions={selectedTagOptions}
        onSearchTag={handleSearchTag}
        onTagsChange={(options) => {
          void handleTagsChange(options)
        }}
      />

      <ImageManagerToolbar
        showThumbnails={showThumbnails}
        onShowThumbnailsChange={setShowThumbnails}
        onRefresh={refreshMediaList}
        onAdd={() => {
          setAddInitialFile(null)
          setDefaultAddOrder(getNextImageSortOrder(imageList))
          setShowAddDialog(true)
        }}
        onReplace={() => setShowReplaceDialog(true)}
        firstImagePath={firstImagePath}
        mediaCount={mediaStats.count}
        totalSize={mediaStats.totalSize}
      />

      <div
        className={cn(
          'flex-1 min-h-0 relative flex flex-col transition-colors duration-150 ease-out',
          isDragging && 'bg-accent/10'
        )}
        {...finalDragHandlers}
      >
        {isDragging && <ImageManagerDragOverlay dragZone={dragZone} />}
        {showThumbnails ? (
          <ImageManagerThumbnailList
            imageList={imageList}
            refreshKey={refreshKey}
            reprobingImageId={reprobingImageId}
            videoOptimizationJobsByImageId={videoOptimizationJobsByImageId}
            startingVideoOptimizationImageId={startingVideoOptimizationImageId}
            onPreviewIndexChange={setPreviewIndex}
            onOpenVideoMetadata={setVideoMetadataTarget}
            onDownload={(path) => {
              void handleDownload(path)
            }}
            onOpenChapterDialog={openChapterDialog}
            onDownloadChapters={(image) => {
              void handleDownloadChapters(image)
            }}
            onDeleteChapter={setDeleteChapterTarget}
            onReprobeVideo={(image) => {
              void handleReprobeVideo(image)
            }}
            onStartVideoOptimization={handleStartVideoOptimization}
            onCancelVideoOptimization={(job) => {
              void handleCancelVideoOptimization(job)
            }}
            onDelete={setDeleteTarget}
          />
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

      <HoverPreview media={hoverImage} x={hoverPos.x} y={hoverPos.y} visible={!!hoverImage} cacheKey={refreshKey} />

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

      <ImageChapterDialog
        open={!!chapterDialogTarget}
        mode={chapterDialogMode}
        image={chapterDialogTarget}
        isSubmitting={isSubmittingChapter}
        onOpenChange={(open) => {
          if (!open) {
            setChapterDialogTarget(null)
          }
        }}
        onSubmit={handleChapterSubmit}
      />

      <MediaVideoMetadataDialog
        open={!!videoMetadataTarget}
        image={videoMetadataTarget}
        onOpenChange={(open) => {
          if (!open) {
            setVideoMetadataTarget(null)
          }
        }}
      />

      <ImageReplaceDialog
        open={showReplaceDialog}
        onOpenChange={setShowReplaceDialog}
        artworkId={artworkId}
        artwork={artwork}
        onSuccess={() => {
          refreshMediaList()
        }}
      />

      <ProDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除媒体"
        description="确定要删除这个媒体文件吗？"
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

      <ProDialog
        open={!!deleteChapterTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteChapterTarget(null)
            setDeleteChapterPhysical(false)
          }
        }}
        title="删除章节"
        description="确定要删除这个视频关联的章节吗？"
        onOk={handleDeleteChapter}
        okText="确定删除"
        okButtonProps={{ variant: 'destructive' }}
        onCancel={() => {
          setDeleteChapterTarget(null)
          setDeleteChapterPhysical(false)
        }}
      >
        <div className="flex flex-row items-start space-x-3 space-y-0 py-4">
          <Checkbox
            id="delete-chapter-physical"
            checked={deleteChapterPhysical}
            onCheckedChange={(checked) => setDeleteChapterPhysical(checked as boolean)}
            className="mt-1"
          />
          <div className="space-y-1 leading-none">
            <Label
              htmlFor="delete-chapter-physical"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              同时删除物理章节文件
            </Label>
            <p className="text-xs text-muted-foreground">
              不勾选时仅清空数据库关联；勾选后会尝试删除源库中的 `.chapters.json` 文件。
            </p>
          </div>
        </div>
      </ProDialog>
    </div>
  )
}
