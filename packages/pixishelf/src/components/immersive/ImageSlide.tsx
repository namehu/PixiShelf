'use client'

import ImageOverlay from './ImageOverlay'
import { useState } from 'react'
import { RandomImageItem } from '@/types/images'

interface ImageSlideProps {
  image: RandomImageItem
  onError?: () => void
}

/**
 * 单张图片滑块组件
 * 负责渲染单张图片，处理图片加载和错误状态
 */
export default function ImageSlide({ image, onError }: ImageSlideProps) {
  const [imageError, setImageError] = useState(false)
  // 添加一个状态用于触发重试
  const [retryKey, setRetryKey] = useState(0)

  const handleImageError = () => {
    setImageError(true)
    onError?.()
  }

  const handleRetry = () => {
    setImageError(false)
    // 通过改变 key 来强制 React 重新渲染 img 元素，并让 Swiper 重新处理
    setRetryKey((prevKey) => prevKey + 1)
  }

  return (
    <div className="relative w-full h-full bg-black">
      {/* 图片容器 */}
      <div className="relative w-full h-full flex items-center justify-center">
        {!imageError ? (
          <>
            {/* 关键改动在这里 */}
            <img
              // 通过附加一个变化的 key 来确保重试时 URL 不同，避免浏览器缓存问题
              key={`${image.id}-${retryKey}`}
              // Swiper 会查找这个 data-src
              src={image.imageUrl}
              alt={image.title || `Image by ${image.author?.name || 'Unknown'}`}
              // 添加 swiper-lazy 类名是必须的
              className="w-full h-full object-contain swiper-lazy"
              // 浏览器原生懒加载作为备用方案
              loading="lazy"
              // 绑定错误处理函数
              onError={handleImageError}
            />
            {/* 1. (核心修复) 添加 Swiper 必需的 preloader 元素 */}
            <div className="swiper-lazy-preloader swiper-lazy-preloader-white"></div>
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
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <p className="text-sm opacity-60 mb-2">图片加载失败</p>
              <button
                // 调用新的重试处理函数
                onClick={handleRetry}
                className="px-4 py-2 bg-white/10 rounded-lg text-sm hover:bg-white/20 transition-colors"
              >
                重试
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 图片覆盖层 (只有在图片加载成功时才显示) */}
      {!imageError && <ImageOverlay image={image} />}
    </div>
  )
}
