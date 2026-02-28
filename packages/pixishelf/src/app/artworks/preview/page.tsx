'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Zoom, Navigation, Pagination, Mousewheel, Keyboard } from 'swiper/modules'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import { useArtworkStore } from '@/store/useArtworkStore'
import { isVideoFile } from '@/types'
import { combinationApiResource } from '@/utils/combinationStatic'
import VideoPlayer from '@/components/players/VideoPlayer'
import ApngPlayer from '@/components/players/ApngPlayer'
import { useQueryState, parseAsInteger } from 'nuqs'

// Import Swiper styles
import 'swiper/css'
import 'swiper/css/zoom'
import 'swiper/css/navigation'
import 'swiper/css/pagination'

import './styles.css' // Create a local style file for custom overrides if needed
import { useShallow } from 'zustand/shallow'
import { getMediaInfo, isApngFile } from '../../../../lib/media'
import { ArtworkImageResponseDto } from '@/schemas/artwork.dto'

export default function ArtworkPreviewPage() {
  const router = useRouter()
  const { images, clearImages } = useArtworkStore(
    useShallow((state) => ({
      images: state.images,
      clearImages: state.clearImages
    }))
  )

  const [currentIndex, setCurrentIndex] = useQueryState('index', parseAsInteger.withDefault(0))
  const [mounted, setMounted] = useState(false)
  const [swiperInstance, setSwiperInstance] = useState<any>(null)
  const [isJumping, setIsJumping] = useState(false)
  const [jumpValue, setJumpValue] = useState('')

  const { ext, isApng, isVideo } = useMemo(() => {
    const it: any = images[currentIndex] ?? {}
    const m = getMediaInfo(it.raw?.path || it.path)
    return m
  }, [images, currentIndex])

  useEffect(() => {
    setMounted(true)
    // Hide body scroll
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
          <p className="mb-4">没有可预览的图片</p>
          <button onClick={() => router.back()} className="rounded bg-white/10 px-4 py-2 hover:bg-white/20">
            返回
          </button>
        </div>
      </div>
    )
  }

  function renderSwiperSlide(image: ArtworkImageResponseDto & { raw?: ArtworkImageResponseDto }, index: number) {
    const imgPath = image.raw?.path || image.path
    const isVideo = isVideoFile(imgPath)
    const isApng = isApngFile(imgPath)

    if (isApng) {
      return (
        <SwiperSlide key={image.id || index} className="flex items-center justify-center overflow-hidden">
          <div className="flex h-full w-full items-center justify-center">
            <ApngPlayer src={imgPath} alt={`Preview ${index}`} />
          </div>
        </SwiperSlide>
      )
    }

    if (isVideo) {
      return (
        <SwiperSlide key={image.id || index} className="flex items-center justify-center overflow-hidden">
          <div className="flex h-full w-full items-center justify-center">
            <VideoPlayer src={imgPath} className="max-h-full max-w-full" />
          </div>
        </SwiperSlide>
      )
    }

    return (
      <SwiperSlide key={image.id || index} className="flex items-center justify-center overflow-hidden">
        <div className="swiper-zoom-container">
          <Image
            src={combinationApiResource(imgPath)!}
            alt={`Preview ${index}`}
            width={0}
            height={0}
            sizes="100vw"
            className="max-h-full w-full object-contain"
            loading={Math.abs(index - currentIndex) < 1 ? 'eager' : 'lazy'}
          />
        </div>
      </SwiperSlide>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black text-white">
      {/* Top Bar */}
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
                <input
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
              <div
                className="cursor-pointer rounded px-2 py-0.5 text-sm font-medium hover:bg-white/10"
                onClick={() => {
                  setJumpValue((currentIndex + 1).toString())
                  setIsJumping(true)
                }}
              >
                {currentIndex + 1} / {images.length}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => router.back()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-sm transition-colors hover:bg-black/40"
        >
          <X size={24} />
        </button>
      </div>

      {/* Swiper */}
      <Swiper
        direction="vertical"
        modules={[Zoom, Navigation, Pagination, Mousewheel, Keyboard]}
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

        {/* Custom Navigation Buttons (Desktop) - Vertical Layout */}
        <div className="absolute bottom-8 right-8 z-10 hidden flex-col gap-4 sm:flex">
          <div className="swiper-button-prev-custom flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-sm transition-all hover:bg-black/40">
            <ChevronUp size={24} />
          </div>
          <div className="swiper-button-next-custom flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-sm transition-all hover:bg-black/40">
            <ChevronDown size={24} />
          </div>
        </div>
      </Swiper>
    </div>
  )
}
