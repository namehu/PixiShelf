'use client'

import { useCallback, useEffect } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import Image from 'next/image'
import { appendCacheKey } from './utils'
import { ImageListItem } from './types'

interface ImagePreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  images: ImageListItem[]
  currentIndex: number | null
  onIndexChange: (index: number) => void
  cacheKey: number
}

export function ImagePreviewDialog({
  open,
  onOpenChange,
  images,
  currentIndex,
  onIndexChange,
  cacheKey
}: ImagePreviewDialogProps) {
  const handlePrev = useCallback(() => {
    if (currentIndex !== null && currentIndex > 0) {
      onIndexChange(currentIndex - 1)
    }
  }, [currentIndex, onIndexChange])

  const handleNext = useCallback(() => {
    if (currentIndex !== null && currentIndex < images.length - 1) {
      onIndexChange(currentIndex + 1)
    }
  }, [currentIndex, images.length, onIndexChange])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open || currentIndex === null) return
      if (e.key === 'ArrowLeft') handlePrev()
      if (e.key === 'ArrowRight') handleNext()
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, currentIndex, handlePrev, handleNext, onOpenChange])

  // Early return if no valid image to show, but only if open
  // We render ProDialog anyway so it handles the "open" state animation correctly
  const currentImage = currentIndex !== null ? images[currentIndex] : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-screen-xl w-full h-screen sm:h-[90vh] p-0 gap-0 bg-black/95 border-none flex flex-col overflow-hidden"
      >
        <DialogTitle className="sr-only">Image Preview</DialogTitle>
        {currentImage && (
          <>
            <div className="absolute top-4 right-4 z-50 flex gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="text-white/70 hover:text-white hover:bg-white/10 rounded-full"
                onClick={() => onOpenChange(false)}
              >
                <X className="w-6 h-6" />
              </Button>
            </div>

            <div className="flex-1 relative flex items-center justify-center w-full h-full overflow-hidden">
              <div className="relative w-full h-full">
                <Image
                  src={appendCacheKey(currentImage.path, cacheKey)}
                  alt="Preview"
                  fill
                  className="object-contain"
                  quality={90}
                  priority
                />
              </div>

              {/* Navigation */}
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white hover:bg-white/10 rounded-full w-12 h-12"
                onClick={(e) => {
                  e.stopPropagation()
                  handlePrev()
                }}
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="w-8 h-8" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white hover:bg-white/10 rounded-full w-12 h-12"
                onClick={(e) => {
                  e.stopPropagation()
                  handleNext()
                }}
                disabled={currentIndex === images.length - 1}
              >
                <ChevronRight className="w-8 h-8" />
              </Button>
            </div>

            <div className="h-16 bg-black/50 flex items-center justify-center text-white/80 gap-4 text-sm font-mono shrink-0">
              <span>
                {(currentIndex || 0) + 1} / {images.length}
              </span>
              <span>|</span>
              <span>{currentImage.path.split('/').pop()}</span>
              <span>|</span>
              <span>
                {currentImage.width}x{currentImage.height}
              </span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
