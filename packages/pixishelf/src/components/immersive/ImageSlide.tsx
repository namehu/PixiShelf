'use client'

import Image from 'next/image'
import { ImageItem } from '@/hooks/useInfiniteImages'
import ImageOverlay from './ImageOverlay'
import { useState } from 'react'
import ClientImage from '../client-image'

interface ImageSlideProps {
  image: ImageItem
  priority?: boolean
  onError?: () => void
}

/**
 * 单张图片滑块组件
 * 负责渲染单张图片，处理图片加载和错误状态
 */
export default function ImageSlide({ image, onError }: ImageSlideProps) {
  const [imageError, setImageError] = useState(false)

  const handleImageError = () => {
    setImageError(true)
    onError?.()
  }

  return (
    <div className="relative w-full h-full">
      {/* 图片容器 */}
      <div className="relative w-full h-full">
        {!imageError ? (
          <>
            {/* 图片 */}
            <ClientImage
              src={image.imageUrl}
              alt={image.title || `Image by ${image.author?.name || 'Unknown'}`}
              fill // 填充整个父容器
              loading="eager"
              style={{ objectFit: 'contain' }} // 保持图片比例，完整显示
              sizes="(max-width: 768px) 100vw, 420px" // 响应式尺寸优化
              onError={handleImageError}
              className={`transition-opacity duration-300`}
            />
          </>
        ) : (
          /* 错误状态 */
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-800">
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
                onClick={() => {
                  setImageError(false)
                }}
                className="px-4 py-2 bg-white/10 rounded-lg text-sm hover:bg-white/20 transition-colors"
              >
                重试
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 图片覆盖层 */}
      <ImageOverlay image={image} />
    </div>
  )
}
