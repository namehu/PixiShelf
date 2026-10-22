'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Zoom, Navigation, Pagination, Mousewheel, Keyboard, Virtual } from 'swiper/modules'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { useArtworkStore } from '@/store/use-artwork-store'
import { isVideoFile } from '@/types'
import { combinationApiResource } from '@/utils/combination-static'
import VideoPlayer from '@/components/players/video-player'
import ApngPlayer from '@/components/players/apng-player'
import { useQueryState, parseAsInteger } from 'nuqs'

// 引入 Swiper 样式
import 'swiper/css'
import 'swiper/css/zoom'
import 'swiper/css/navigation'
import 'swiper/css/pagination'

import './styles.css' // 引入本地样式文件，用于需要时定制覆盖
import { getMediaInfo, isApngFile } from '@/lib/media'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useSafeBack } from '@/hooks/use-safe-back'
import { useVideoReading } from '@/lib/reading/use-video-reading'
import { ArtworkReaderProvider, useArtworkReader, useReaderMediaWindow, MediaDetailsPlaceholder } from '@/lib/reading/artwork-reader-provider'
import { Button } from '@/components/ui/button'
import { MediaMarkActions } from '@/components/media-mark/media-mark-actions'

export default function ArtworkPreviewPage() {
  const [artworkId] = useQueryState('artworkId', parseAsInteger)
  return <ArtworkReaderProvider key={artworkId} artworkId={artworkId ?? 0}><ArtworkPreviewContent /></ArtworkReaderProvider>
}
function ArtworkPreviewContent() {
  const safeBack = useSafeBack()
  const clearImages = useArtworkStore((state) => state.clearImages)

  const [currentIndex, setCurrentIndex] = useQueryState('index', parseAsInteger.withDefault(0))
  const [artworkId] = useQueryState('artworkId', parseAsInteger)
  const reader = useArtworkReader()!
  const images = reader.images
  const reading = reader.reading
  useReaderMediaWindow('original', images.slice(Math.max(0, currentIndex - 1), currentIndex + 3).map((image) => image.id))
  const [readyIds, setReadyIds] = useState<Set<number>>(() => new Set())
  const [errorIds, setErrorIds] = useState<Set<number>>(() => new Set())
  const [mounted, setMounted] = useState(false)
  const [swiperInstance, setSwiperInstance] = useState<any>(null)
  const [isJumping, setIsJumping] = useState(false)
  const [jumpValue, setJumpValue] = useState('')
  const activeMediaId = images[currentIndex]?.id
  const activeMediaReady = !reader.invalidated && activeMediaId !== undefined && readyIds.has(activeMediaId) && !errorIds.has(activeMediaId)
  const observe = reading.observe
  const clearSurface = reading.clearSurface
  const observationEpoch = reading.observationEpoch
  const activeVideo = isVideoFile(images[currentIndex]?.raw?.path || images[currentIndex]?.path || '')
  const videoReading = useVideoReading(`${reading.ownerUserId}:${artworkId}:${activeMediaId}`, mounted)
  const playback = videoReading.playback
  useEffect(() => {
    if (!artworkId || !activeMediaId) return
    const surfaceId = 'original-preview'
    observe(surfaceId, {
      mediaId: activeMediaId,
      ready: activeMediaReady && (!activeVideo || playback !== null),
      visible: mounted,
      automatic: false,
      priority: 100,
      ...(activeVideo && playback ? { playback } : {})
    })
  }, [activeMediaId, activeMediaReady, artworkId, mounted, observationEpoch, observe, activeVideo, playback])
  useEffect(() => () => clearSurface('original-preview'), [clearSurface])
  const markReady = (mediaId: number) => {
    setReadyIds((current) => new Set(current).add(mediaId))
    setErrorIds((current) => {
      const next = new Set(current)
      next.delete(mediaId)
      return next
    })
  }
  const markError = (mediaId: number) => {
    setErrorIds((current) => new Set(current).add(mediaId))
    setReadyIds((current) => {
      const next = new Set(current)
      next.delete(mediaId)
      return next
    })
  }

  const { ext, isApng, isVideo } = useMemo(() => {
    const it: any = images[currentIndex] ?? {}
    const m = getMediaInfo(it.raw?.path || it.path)
    return m
  }, [images, currentIndex])

  useEffect(() => {
    setMounted(true)
    // 锁定页面滚动，避免与预览手势冲突
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = 'unset'

      if (process.env.NODE_ENV !== 'development') {
        clearImages()
      }
    }
  }, [])

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const target = parseInt(jumpValue)
    if (!isNaN(target) && target > 0 && target <= images.length && swiperInstance) {
      swiperInstance.slideTo(target - 1)
      setIsJumping(false)
    }
  }

  if (!mounted) return null

  if (!images.length) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-black text-white">
        <div className="text-center">
          <p className="mb-4">{reader.isLoading ? '正在加载作品…' : reader.error ? '加载失败，请重试' : '没有可预览的图片'}</p>
          {reader.error && <Button onClick={() => void reader.retry()}>重试</Button>}
          <button type="button" onClick={safeBack} className="rounded bg-white/10 px-4 py-2 hover:bg-white/20">
            返回
          </button>
        </div>
      </div>
    )
  }

  function renderSwiperSlide(image: ArtworkImageResponseDto & { raw?: ArtworkImageResponseDto | null }, index: number) {
    if (Math.abs(index - currentIndex) > 2) return <SwiperSlide virtualIndex={index} key={image.id} />
    if (image.detailsPending) return <SwiperSlide virtualIndex={index} key={image.id}><MediaDetailsPlaceholder media={image} index={index} fill /></SwiperSlide>
    const imgPath = image.raw?.path || image.path
    const isVideo = isVideoFile(imgPath)
    const isApng = isApngFile(imgPath)

    if (isApng) {
      return (
        <SwiperSlide virtualIndex={index} key={image.id || index} className="flex items-center justify-center overflow-hidden">
          <div className="flex h-full w-full items-center justify-center">
            <ApngPlayer
              src={imgPath}
              alt={`Preview ${index}`}
              onPosterLoad={() => markReady(image.id)}
              onPosterError={() => markError(image.id)}
            />
          </div>
        </SwiperSlide>
      )
    }

    if (isVideo) {
      return (
        <SwiperSlide virtualIndex={index} key={image.id || index} className="flex items-center justify-center overflow-hidden">
          <div className="flex h-full w-full items-center justify-center">
            <VideoPlayer
              src={imgPath}
              chaptersUrl={image.chaptersUrl}
              chaptersCount={image.chaptersCount}
              keyframesUrl={image.keyframesUrl}
              keyframeCount={image.keyframeCount}
              hasAudio={image.hasAudio}
              size={image.size}
              className="h-full w-full"
              fillParent={true}
              onReady={() => markReady(image.id)}
              onReadingProgress={index === currentIndex ? videoReading.onProgress : undefined}
              onError={() => markError(image.id)}
            />
          </div>
        </SwiperSlide>
      )
    }

    return (
      <SwiperSlide virtualIndex={index} key={image.id || index} className="flex items-center justify-center overflow-hidden">
        <div className="swiper-zoom-container">
          <Image
            src={combinationApiResource(imgPath)!}
            alt={`Preview ${index}`}
            width={0}
            height={0}
            sizes="100vw"
            className="max-h-full w-full object-contain"
            loading={Math.abs(index - currentIndex) < 1 ? 'eager' : 'lazy'}
            onLoad={() => markReady(image.id)}
            onError={() => markError(image.id)}
          />
        </div>
      </SwiperSlide>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black text-white">
      {reader.invalidated ? (
        <div className="absolute inset-x-4 top-16 z-30 flex items-center justify-between gap-3 rounded-lg bg-background p-3 text-sm text-foreground shadow-lg" role="status">
          <span>作品媒体已更新，请重新打开阅读。</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void reading.reopen()}>重新打开</Button>
        </div>
      ) : null}
      {/* 顶部控制条 */}
      <div className="absolute left-0 right-0 top-0 z-10 flex h-16 items-center justify-between bg-gradient-to-b from-black/50 to-transparent px-4">
        <div className="flex items-center gap-3">
          {isApng || isVideo ? (
            <span className="rounded bg-white/20 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-white/90 backdrop-blur-md">
              {ext}
            </span>
          ) : null}

          <div className="flex items-center">
            {isJumping ? (
              <form onSubmit={handleJumpSubmit} className="flex items-center">
                <label htmlFor="preview-page-jump" className="sr-only">
                  跳转到作品页码
                </label>
                <input
                  id="preview-page-jump"
                  name="preview-page-jump"
                  autoComplete="off"
                  aria-label="跳转到作品页码"
                  autoFocus
                  type="number"
                  min={1}
                  max={images.length}
                  value={jumpValue}
                  onChange={(e) => setJumpValue(e.target.value)}
                  onBlur={() => setIsJumping(false)}
                  className="w-16 rounded bg-white/20 px-2 py-0.5 text-center text-sm text-white backdrop-blur-md focus:outline-none focus:ring-1 focus:ring-white/50"
                />
                <span className="ml-2 text-sm font-medium">/ {images.length}</span>
              </form>
            ) : (
              <button
                type="button"
                aria-label={`跳转页码，当前第 ${currentIndex + 1} 页，共 ${images.length} 页`}
                className="rounded px-2 py-0.5 text-sm font-medium hover:bg-white/10"
                onClick={() => {
                  setJumpValue((currentIndex + 1).toString())
                  setIsJumping(true)
                }}
              >
                {currentIndex + 1} / {images.length}
              </button>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <MediaMarkActions artworkId={artworkId ?? 0} mediaId={reader.invalidated ? null : activeMediaId ?? null} overlay />
          <button
            type="button"
            aria-label="关闭作品预览"
            onClick={safeBack}
            className="flex size-11 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-sm transition-colors hover:bg-black/40"
          >
            <X aria-hidden="true" size={24} />
          </button>
        </div>
      </div>

      {/* Swiper 轮播容器 */}
      <Swiper
        direction="vertical"
        modules={[Zoom, Navigation, Pagination, Mousewheel, Keyboard, Virtual]}
        virtual={{ enabled: true, addSlidesBefore: 1, addSlidesAfter: 2 }}
        zoom={{
          maxRatio: 3,
          minRatio: 1
        }}
        mousewheel={true}
        keyboard={{
          enabled: true
        }}
        navigation={{
          prevEl: '.swiper-button-prev-custom',
          nextEl: '.swiper-button-next-custom'
        }}
        pagination={false}
        initialSlide={currentIndex}
        onSwiper={setSwiperInstance}
        onSlideChange={(swiper) => setCurrentIndex(swiper.activeIndex)}
        className="h-full w-full"
        spaceBetween={20}
      >
        {images.map(renderSwiperSlide)}

        {/* 自定义导航按钮（桌面端）：上下布局 */}
        <div className="absolute bottom-8 right-8 z-10 hidden flex-col gap-4 sm:flex">
          <button
            type="button"
            aria-label="上一张媒体"
            className="swiper-button-prev-custom flex size-12 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-sm transition-colors hover:bg-black/40"
          >
            <ChevronUp size={24} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="下一张媒体"
            className="swiper-button-next-custom flex size-12 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-sm transition-colors hover:bg-black/40"
          >
            <ChevronDown size={24} aria-hidden="true" />
          </button>
        </div>
      </Swiper>
    </div>
  )
}
