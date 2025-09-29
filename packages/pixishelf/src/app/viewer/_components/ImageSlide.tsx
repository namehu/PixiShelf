'use client'

import ImageOverlay from './ImageOverlay'
import { useState, useRef, useEffect } from 'react'
import { RandomImageItem } from '@/types/images'
import { MediaType } from '@/types'
import { Swiper, SwiperRef, SwiperSlide } from 'swiper/react'
import { Navigation, Pagination, Keyboard } from 'swiper/modules'
import type { Swiper as SwiperType } from 'swiper'

// 导入Swiper样式
import 'swiper/css'
import 'swiper/css/navigation'
import 'swiper/css/pagination'

interface ImageSlideProps extends Pick<SingleImageProps, 'onError'> {
  image: RandomImageItem
}

interface SingleImageProps {
  image: string
  mediaType: MediaType
  id: string
  onError?: (() => void) | undefined
  retryKey: number
  onRetry: () => void
}

/**
 * 单张图片渲染组件
 */
function SingleImage({ image, mediaType, id, onError, retryKey, onRetry }: SingleImageProps) {
  const [imageError, setImageError] = useState(false)

  const handleImageError = () => {
    setImageError(true)
    onError?.()
  }

  useEffect(() => {
    setImageError(false)
  }, [retryKey])

  return (
    <div className="relative w-full h-full flex items-center justify-center">
      {!imageError ? (
        <>
          {mediaType === MediaType.IMAGE ? (
            <img
              key={`${id}-${retryKey}`}
              src={image}
              alt={id || `Image by ${id || 'Unknown'}`}
              className="w-full h-full object-contain"
              loading="lazy"
              onError={handleImageError}
            />
          ) : (
            <video
              key={`${id}-${retryKey}`}
              src={image}
              autoPlay
              controls={false}
              loop
              muted
              className="w-full h-full object-contain"
              onError={handleImageError}
            />
          )}
        </>
      ) : (
        /* 错误状态UI */
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
          <div className="text-center text-white">
            <div className="mb-4">
              <svg className="w-16 h-16 mx-auto opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 002 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <p className="text-sm opacity-60 mb-2">{mediaType === MediaType.IMAGE ? '图片' : '视频'}加载失败</p>
            <button
              onClick={onRetry}
              className="px-4 py-2 bg-white/10 rounded-lg text-sm hover:bg-white/20 transition-colors"
            >
              重试
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 图片滑块组件
 * 支持单图和多图横向滑动浏览
 */
export default function ImageSlide({ image, onError }: ImageSlideProps) {
  const [retryKey, setRetryKey] = useState(0)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const swiperRef = useRef<SwiperRef | null>(null)

  const handleRetry = () => {
    setRetryKey((prevKey) => prevKey + 1)
  }

  // 检查是否有多张图片
  const hasMultipleImages = image.images && image.images.length > 1
  const imagesToShow = hasMultipleImages ? image.images : [image]

  // 处理滑动变化
  const handleSlideChange = (swiper: SwiperType) => {
    setCurrentImageIndex(swiper.activeIndex)
  }

  if (!hasMultipleImages) {
    // 单图模式
    return (
      <div className="relative w-full h-full bg-black">
        <SingleImage
          image={image.imageUrl}
          mediaType={image.mediaType}
          id={image.key}
          onError={onError}
          retryKey={retryKey}
          onRetry={handleRetry}
        />
        <ImageOverlay image={image} />
      </div>
    )
  }

  // 多图模式
  return (
    <div className="relative w-full h-full bg-black">
      <Swiper
        ref={(swiper) => {
          swiperRef.current = swiper
        }}
        modules={[Navigation, Pagination, Keyboard]}
        direction="horizontal"
        slidesPerView={1}
        lazyPreloadPrevNext={1}
        spaceBetween={0}
        keyboard={{
          enabled: true,
          onlyInViewport: true
        }}
        pagination={{
          clickable: true,
          bulletClass: 'swiper-pagination-bullet !bg-white/50',
          bulletActiveClass: 'swiper-pagination-bullet-active !bg-white'
        }}
        navigation={{
          nextEl: '.swiper-button-next-custom',
          prevEl: '.swiper-button-prev-custom'
        }}
        onSlideChange={handleSlideChange}
        // 移动端手势优化配置
        touchRatio={1}
        touchAngle={45}
        grabCursor={true}
        resistance={true}
        resistanceRatio={0.85}
        speed={300}
        // 防止与父级Swiper冲突
        nested={true}
        className="w-full h-full"
      >
        {image.images.map((img, index) => (
          <SwiperSlide key={`${img.key}-${index}`}>
            <SingleImage
              image={img.url}
              mediaType={image.mediaType}
              id={img.key}
              onError={onError}
              retryKey={retryKey}
              onRetry={handleRetry}
            />
          </SwiperSlide>
        ))}
      </Swiper>

      {/* 自定义导航按钮 */}
      {/* {imagesToShow.length > 1 && (
        <>
          <button className="swiper-button-prev-custom absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-black/30 hover:bg-black/50 rounded-full flex items-center justify-center text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button className="swiper-button-next-custom absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 bg-black/30 hover:bg-black/50 rounded-full flex items-center justify-center text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </>
      )} */}

      {/* 图片计数器 */}
      {imagesToShow.length > 1 && (
        <div className="absolute top-4 right-4 z-10 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
          {currentImageIndex + 1} / {imagesToShow.length}
        </div>
      )}

      {/* 覆盖层 - 使用当前显示的图片信息 */}
      <ImageOverlay image={image} />
    </div>
  )
}
