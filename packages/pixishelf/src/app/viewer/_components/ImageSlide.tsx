'use client'

import { useState, useRef, useEffect } from 'react'
import { RandomImageItem } from '@/types/images'
import { MediaType } from '@/types'
import { Swiper, SwiperRef, SwiperSlide } from 'swiper/react'
import { Navigation, Keyboard } from 'swiper/modules'
import type { Swiper as SwiperType } from 'swiper'

// 导入Swiper样式
import 'swiper/css'
import 'swiper/css/navigation'
import 'swiper/css/pagination'
import ImageOverlay from './ImageOverlay'
import Image from 'next/image'
import { useViewerStore, getHorizontalIndex } from '@/store/viewerStore'

interface ImageSlideProps extends Pick<SingleImageProps, 'onError'> {
  image: RandomImageItem
  isActive: boolean
  isPreloading: boolean
}

interface SingleImageProps {
  image: string
  mediaType: MediaType
  id: string
  onError?: (() => void) | undefined
  retryKey: number
  priority?: boolean
  isPreloading?: boolean
  onRetry: () => void
}

/**
 * 单张图片渲染组件
 */
function SingleImage({
  image,
  mediaType,
  id,
  onError,
  retryKey,
  onRetry,
  priority = false,
  isPreloading = false,
  shouldLoad = true
}: SingleImageProps & { shouldLoad?: boolean }) {
  const [imageError, setImageError] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleImageError = () => {
    setImageError(true)
    onError?.()
  }

  useEffect(() => {
    setImageError(false)
  }, [retryKey])

  // 如果不应该加载，显示占位符
  if (!shouldLoad) {
    return (
      <div className="relative w-full h-full flex items-center justify-center bg-neutral-800">
        <div className="text-center text-white/40">
          <div className="w-16 h-16 mx-auto mb-2 bg-white/10 rounded-lg flex items-center justify-center">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 002 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p className="text-xs">准备加载...</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      {!imageError ? (
        <>
          {mediaType === MediaType.IMAGE ? (
            <Image
              key={`${id}-${retryKey}`}
              src={image}
              width={window.outerWidth}
              height={window.outerHeight}
              alt={id || `Image by ${id || 'Unknown'}`}
              className="w-full h-full object-contain"
              // 当图片是当前活动(priority)或需要预加载(isPreloading)时，
              // 强制使用 eager 模式，让浏览器立即加载。
              // 否则，使用默认的 lazy 模式。
              loading={priority || isPreloading ? 'eager' : 'lazy'}
              // priority 属性会给 Next.js 最高优先级，通常只给当前视口的图片
              priority={priority}
              quality={100}
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
              preload={priority || isPreloading ? 'auto' : 'none'}
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
 * 集成状态管理，支持水平滑动位置恢复
 */
export default function ImageSlide({ isActive, isPreloading, image, onError }: ImageSlideProps) {
  const [retryKey, setRetryKey] = useState(0)

  // 从状态管理中获取初始水平索引
  const initialHorizontalIndex = getHorizontalIndex(image.key)
  const [currentImageIndex, setCurrentImageIndex] = useState(initialHorizontalIndex)
  const swiperRef = useRef<SwiperRef | null>(null)
  const { setHorizontalIndex } = useViewerStore()

  const handleRetry = () => {
    setRetryKey((prevKey) => prevKey + 1)
  }

  // 检查是否有多张图片
  const hasMultipleImages = image.images && image.images.length > 1
  const imagesToShow = hasMultipleImages ? image.images : [image]

  // 处理滑动变化
  const handleSlideChange = (swiper: SwiperType) => {
    const newIndex = swiper.activeIndex
    setCurrentImageIndex(newIndex)
    // 同步到状态管理
    setHorizontalIndex(image.key, newIndex)
  }

  // 状态恢复：当组件挂载时，如果有缓存的水平索引，则滑动到对应位置
  useEffect(() => {
    if (hasMultipleImages && swiperRef.current && initialHorizontalIndex > 0) {
      // 延迟执行，确保 Swiper 已经完全初始化
      const timer = setTimeout(() => {
        swiperRef.current?.swiper?.slideTo(initialHorizontalIndex, 0) // 0ms 动画时间，立即跳转
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [hasMultipleImages, initialHorizontalIndex])

  if (!hasMultipleImages) {
    // 单图模式
    return (
      <>
        <SingleImage
          image={image.imageUrl}
          mediaType={image.mediaType}
          id={image.key}
          priority={isActive}
          isPreloading={isPreloading}
          onError={onError}
          retryKey={retryKey}
          onRetry={handleRetry}
        />
        <ImageOverlay isActive={isActive} image={image} />
      </>
    )
  }

  // 多图模式
  return (
    <>
      <Swiper
        ref={(swiper) => {
          swiperRef.current = swiper
        }}
        modules={[Navigation, Keyboard]}
        direction="horizontal"
        slidesPerView={1}
        lazyPreloadPrevNext={1}
        spaceBetween={0}
        // 初始索引配置
        initialSlide={initialHorizontalIndex}
        keyboard={{
          enabled: true,
          onlyInViewport: true
        }}
        // 使用自定义 progressbar，不需要内置 pagination
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
        className="w-full h-full relative z-10"
        style={{
          zIndex: 10 // 确保嵌套 Swiper 有足够高的层级
        }}
      >
        {image.images.map((img, index) => {
          const isCurrentImage = index === currentImageIndex
          // 只渲染当前图片和相邻的图片（前一张和后一张）
          const shouldLoad = isActive
            ? Math.abs(index - currentImageIndex) <= 1
            : Math.abs(index - currentImageIndex) < 1

          return (
            <SwiperSlide key={`${img.key}-${index}`}>
              <SingleImage
                image={img.url}
                mediaType={image.mediaType}
                id={img.key}
                // 只有当外部幻灯片(垂直)和内部幻灯片(水平)都为当前时，才设置最高优先级
                priority={isActive && isCurrentImage}
                isPreloading={isPreloading}
                onError={onError}
                retryKey={retryKey}
                onRetry={handleRetry}
                shouldLoad={shouldLoad}
              />
            </SwiperSlide>
          )
        })}
      </Swiper>

      {/* 分段式进度条 pagination - 放在底部 */}
      {imagesToShow.length > 1 && (
        <div className="swiper-pagination-custom absolute !bottom-0.5 left-4 right-4 z-30">
          <div className="flex gap-1 w-full">
            {imagesToShow.map((_, index) => (
              <div
                key={index}
                className={`h-1 rounded-full transition-all duration-300 ease-out flex-1 ${
                  index <= currentImageIndex ? 'bg-white' : 'bg-white/20'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* 将 ImageOverlay 移出 Swiper，作为独立的覆盖层 */}
      <ImageOverlay isActive={isActive} image={image} />

      {/* 图片计数器 */}
      {imagesToShow.length > 1 && (
        <div className="absolute top-4 right-4 z-30 bg-black/50 text-white px-3 py-1 rounded-full text-sm">
          {currentImageIndex + 1} / {imagesToShow.length}
        </div>
      )}
    </>
  )
}
