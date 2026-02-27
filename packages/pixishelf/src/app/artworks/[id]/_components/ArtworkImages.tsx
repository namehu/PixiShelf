'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'framer-motion'
import LazyMedia from './LazyMedia'

interface ArtworkImagesProps {
  images: { id: number; path: string }[]
}

const MAX_PREVIEW_IMAGES = 20

export default function ArtworkImages({ images }: ArtworkImagesProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // 如果图片少于或等于MAX_PREVIEW_IMAGES张，直接显示全部，无需按钮逻辑
  if (images.length <= MAX_PREVIEW_IMAGES) {
    return (
      <div className="w-full px-2" data-testid="artwork-images-container">
        {images.map((img, index) => (
          <LazyMedia key={img.id} src={img.path} index={index} />
        ))}
      </div>
    )
  }

  const initialImages = images.slice(0, MAX_PREVIEW_IMAGES)
  const remainingImages = images.slice(MAX_PREVIEW_IMAGES)

  return (
    <div className="w-full px-2" data-testid="artwork-images-container">
      {/* 前MAX_PREVIEW_IMAGES张图片始终显示 */}
      {initialImages.map((img, index) => {
        // 判断是否是最后一张预览图（第MAX_PREVIEW_IMAGES张，index为MAX_PREVIEW_IMAGES-1），且尚未展开
        const isLastPreview = !isExpanded && index === MAX_PREVIEW_IMAGES - 1

        return (
          <div key={img.id} className="relative group">
            <LazyMedia src={img.path} index={index} />

            {/* 渐变遮罩和按钮 - 仅在第MAX_PREVIEW_IMAGES张且未展开时显示 */}
            {isLastPreview && (
              <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-white via-white/90 to-transparent flex items-end justify-center  z-10">
                <Button
                  variant="secondary"
                  onClick={() => setIsExpanded(true)}
                  className="w-full md:w-auto min-w-[240px] px-8 h-12 rounded-full text-base font-medium transition-all hover:bg-gray-200 shadow-sm"
                >
                  查看剩余 {remainingImages.length} 张图片
                </Button>
              </div>
            )}
          </div>
        )
      })}

      {/* 剩余图片展开动画 */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            data-testid="expanded-images"
          >
            {remainingImages.map((img, index) => (
              <LazyMedia key={img.id} src={img.path} index={index + MAX_PREVIEW_IMAGES} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
