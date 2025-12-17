'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Zoom, Navigation, Pagination } from 'swiper/modules'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { useArtworkStore } from '@/store/useArtworkStore'
import { isVideoFile } from '@/types'
import { combinationApiResource } from '@/utils/combinationStatic'
import VideoPlayer from '@/components/ui/VideoPlayer'

// Import Swiper styles
import 'swiper/css'
import 'swiper/css/zoom'
import 'swiper/css/navigation'
import 'swiper/css/pagination'

import './styles.css' // Create a local style file for custom overrides if needed
import { useShallow } from 'zustand/shallow'
import { getMediaInfo } from '../../../../lib/media'

export default function ArtworkPreviewPage() {
  const router = useRouter()
  const { images, clearImages } = useArtworkStore(
    useShallow((state) => ({
      images: state.images,
      clearImages: state.clearImages
    }))
  )

  const [currentIndex, setCurrentIndex] = useState(0)
  const [mounted, setMounted] = useState(false)

  const { ext } = useMemo(() => getMediaInfo(images[currentIndex]?.path), [images, currentIndex])

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

  return (
    <div className="fixed inset-0 z-[100] bg-black text-white">
      {/* Top Bar */}
      <div className="absolute left-0 right-0 top-0 z-10 flex h-16 items-center justify-between bg-gradient-to-b from-black/50 to-transparent px-4">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">
            {currentIndex + 1} / {images.length}
          </div>
          {ext && (
            <span className="rounded bg-white/20 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-white/90 backdrop-blur-md">
              {ext}
            </span>
          )}
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
        modules={[Zoom, Navigation, Pagination]}
        zoom={{
          maxRatio: 3,
          minRatio: 1
        }}
        navigation={{
          prevEl: '.swiper-button-prev-custom',
          nextEl: '.swiper-button-next-custom'
        }}
        pagination={false}
        initialSlide={currentIndex}
        onSlideChange={(swiper) => setCurrentIndex(swiper.activeIndex)}
        className="h-full w-full"
        spaceBetween={20}
      >
        {images.map((image, index) => {
          const isVideo = isVideoFile(image.path)

          return (
            <SwiperSlide key={image.id || index} className="flex items-center justify-center overflow-hidden">
              {isVideo ? (
                <div className="flex h-full w-full items-center justify-center p-4">
                  {/* Video doesn't support zoom in the same way, render player directly */}
                  <VideoPlayer src={combinationApiResource(image.path)} className="max-h-full max-w-full" />
                </div>
              ) : (
                <div className="swiper-zoom-container">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={combinationApiResource(image.path)}
                    alt={`Preview ${index}`}
                    className="max-h-full max-w-full object-contain"
                    loading={Math.abs(index - currentIndex) < 2 ? 'eager' : 'lazy'}
                  />
                </div>
              )}
            </SwiperSlide>
          )
        })}

        {/* Custom Navigation Buttons (Desktop) */}
        <div className="swiper-button-prev-custom absolute left-4 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-black/20 p-2 text-white backdrop-blur-sm transition-all hover:bg-black/40 sm:block hidden">
          <ChevronLeft size={32} />
        </div>
        <div className="swiper-button-next-custom absolute right-4 top-1/2 z-10 -translate-y-1/2 cursor-pointer rounded-full bg-black/20 p-2 text-white backdrop-blur-sm transition-all hover:bg-black/40 sm:block hidden">
          <ChevronRight size={32} />
        </div>
      </Swiper>
    </div>
  )
}
