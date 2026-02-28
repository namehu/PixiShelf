'use client'

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'framer-motion'
import LazyMedia from './LazyMedia'
import { useLongPress } from '@/hooks/useLongPress'
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover'
import { useRouter } from 'next/navigation'
import { useArtworkStore } from '@/store/useArtworkStore'

interface ArtworkImagesProps {
  images: { id: number; path: string }[]
  artworkId: number
}

const MAX_PREVIEW_IMAGES = 20

// Wrapper component to handle long press
const ImageWrapper = ({
  children,
  index,
  onOpenMenu
}: {
  children: React.ReactNode
  index: number
  onOpenMenu: (e: React.MouseEvent | React.TouchEvent, index: number) => void
}) => {
  const { ...longPressProps } = useLongPress({
    onLongPress: (e) => onOpenMenu(e, index),
    threshold: 500
  })

  return <div {...longPressProps}>{children}</div>
}

export default function ArtworkImages({ images }: ArtworkImagesProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const router = useRouter()
  const setStoreImages = useArtworkStore((state) => state.setImages)

  // Handle opening context menu
  const handleOpenMenu = useCallback((e: React.MouseEvent | React.TouchEvent, index: number) => {
    // Get coordinates
    let clientX, clientY
    if ('touches' in e) {
      clientX = e.touches[0]!.clientX
      clientY = e.touches[0]!.clientY
    } else {
      clientX = (e as React.MouseEvent).clientX
      clientY = (e as React.MouseEvent).clientY
    }

    setContextMenu({ x: clientX, y: clientY, index })
  }, [])

  // Handle preview navigation
  const handlePreview = useCallback(() => {
    if (!contextMenu) return

    // Set images in store (cast as any to bypass strict type check if needed, assuming data structure is compatible)
    setStoreImages(images as any)

    // Close menu
    setContextMenu(null)

    // Navigate to preview
    router.push(`/artworks/preview?index=${contextMenu.index}`)
  }, [contextMenu, images, router, setStoreImages])

  // Close menu on scroll or resize
  useEffect(() => {
    const handleClose = () => {
      if (contextMenu) setContextMenu(null)
    }

    window.addEventListener('scroll', handleClose, { capture: true })
    window.addEventListener('resize', handleClose)

    return () => {
      window.removeEventListener('scroll', handleClose, { capture: true })
      window.removeEventListener('resize', handleClose)
    }
  }, [contextMenu])

  const renderContent = () => {
    // 如果图片少于或等于MAX_PREVIEW_IMAGES张，直接显示全部，无需按钮逻辑
    if (images.length <= MAX_PREVIEW_IMAGES) {
      return (
        <div className="w-full px-2" data-testid="artwork-images-container">
          {images.map((img, index) => (
            <ImageWrapper key={img.id} index={index} onOpenMenu={handleOpenMenu}>
              <LazyMedia src={img.path} index={index} />
            </ImageWrapper>
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
              <ImageWrapper index={index} onOpenMenu={handleOpenMenu}>
                <LazyMedia src={img.path} index={index} />
              </ImageWrapper>

              {/* 渐变遮罩和按钮 - 仅在第MAX_PREVIEW_IMAGES张且未展开时显示 */}
              {isLastPreview && (
                <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-white via-white/90 to-transparent flex items-end justify-center z-10">
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
                <ImageWrapper key={img.id} index={index + MAX_PREVIEW_IMAGES} onOpenMenu={handleOpenMenu}>
                  <LazyMedia src={img.path} index={index + MAX_PREVIEW_IMAGES} />
                </ImageWrapper>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <>
      {renderContent()}

      {/* Context Menu Popover */}
      <Popover open={!!contextMenu} onOpenChange={(open) => !open && setContextMenu(null)}>
        {contextMenu && (
          <PopoverAnchor
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              width: 0,
              height: 0
            }}
          />
        )}
        <PopoverContent
          align="start"
          className="w-auto p-1 rounded-[4px] shadow-[0_8px_16px_rgba(0,0,0,0.1)] bg-white border border-[#E5E5E5] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-150 ease-out"
        >
          <div
            onClick={handlePreview}
            className="cursor-pointer px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-[2px] transition-colors select-none"
          >
            预览完整尺寸
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
