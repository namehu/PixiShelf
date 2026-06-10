'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { ListTree, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import LazyMedia from './lazy-media'
import { useLongPress } from '@/hooks/useLongPress'
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover'
import { useRouter } from 'next/navigation'
import { useArtworkStore } from '@/store/useArtworkStore'
import { useArtworkMediaAnchorInterval } from '@/components/user-setting'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { isVideoFile } from '@/lib/media'
import { cn } from '@/lib/utils'

interface ArtworkImagesProps {
  images: ArtworkImageResponseDto[]
  artworkId: number
}

const MAX_PREVIEW_IMAGES = 20
const NAV_HEIGHT = 64

export function buildMediaAnchorIndexes(total: number, interval: number) {
  if (interval <= 0 || total < interval * 2) return []

  const indexes = [0]
  for (let mediaNumber = interval; mediaNumber <= total; mediaNumber += interval) {
    indexes.push(mediaNumber - 1)
  }

  const lastIndex = total - 1
  if (indexes[indexes.length - 1] !== lastIndex) {
    indexes.push(lastIndex)
  }

  return indexes
}

function getEstimatedMediaHeight(media: ArtworkImageResponseDto, containerWidth: number) {
  const width = containerWidth || 656
  if (media.width && media.height && media.width > 0 && media.height > 0) {
    return Math.max(1, (width * media.height) / media.width)
  }

  return width >= 640 ? 500 : 300
}

// Wrapper component to handle long press
const ImageWrapper = ({
  children,
  index,
  previewEnabled,
  onOpenMenu
}: {
  children: React.ReactNode
  index: number
  previewEnabled: boolean
  onOpenMenu: (e: React.MouseEvent | React.TouchEvent, index: number) => void
}) => {
  const { ...longPressProps } = useLongPress({
    onLongPress: (e) => onOpenMenu(e, index),
    threshold: 500
  })

  if (!previewEnabled) {
    return <div>{children}</div>
  }

  return (
    <div
      {...longPressProps}
      className="select-none"
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      style={{ WebkitTouchCallout: 'none' }}
    >
      {children}
    </div>
  )
}

function MediaAnchorList({
  indexes,
  activeIndex,
  onSelect,
  className
}: {
  indexes: number[]
  activeIndex: number
  onSelect: (index: number) => void
  className?: string
}) {
  const activeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeButtonRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  return (
    <nav
      aria-label="作品媒体快捷导航"
      className={cn(
        'max-h-[70vh] overflow-y-auto rounded-xl border border-neutral-200 bg-white/95 p-1.5 shadow-lg backdrop-blur',
        className
      )}
    >
      <div className="flex flex-col gap-0.5">
        {indexes.map((index) => {
          const isActive = index === activeIndex
          return (
            <button
              key={index}
              ref={isActive ? activeButtonRef : undefined}
              type="button"
              aria-current={isActive ? 'true' : undefined}
              aria-label={`跳转到第 ${index + 1} 张媒体`}
              onClick={() => onSelect(index)}
              className={cn(
                'min-w-10 rounded-md px-2 py-1 text-right font-mono text-xs tabular-nums transition-colors text-center',
                isActive
                  ? 'bg-neutral-900 font-semibold text-white'
                  : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'
              )}
            >
              {index + 1}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default function ArtworkImages({ images }: ArtworkImagesProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)
  const pendingScrollIndexRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const anchorInterval = useArtworkMediaAnchorInterval()
  const setStoreImages = useArtworkStore((state) => state.setImages)
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const currentIndex = useArtworkStore((state) => state.currentIndex)
  const visibleCount = isExpanded ? images.length : Math.min(images.length, MAX_PREVIEW_IMAGES)
  const remainingCount = Math.max(0, images.length - MAX_PREVIEW_IMAGES)

  const anchorIndexes = useMemo(
    () => buildMediaAnchorIndexes(images.length, anchorInterval),
    [anchorInterval, images.length]
  )

  const activeAnchorIndex = useMemo(() => {
    if (anchorIndexes.length === 0) return -1
    return anchorIndexes.reduce((closest, index) =>
      Math.abs(index - currentIndex) < Math.abs(closest - currentIndex) ? index : closest
    )
  }, [anchorIndexes, currentIndex])

  const estimateSize = useCallback(
    (index: number) => getEstimatedMediaHeight(images[index]!, containerWidth),
    [containerWidth, images]
  )
  const getItemKey = useCallback((index: number) => images[index]?.id ?? index, [images])

  const virtualizer = useWindowVirtualizer({
    useFlushSync: false,
    count: visibleCount,
    estimateSize,
    overscan: 2,
    scrollMargin,
    scrollPaddingStart: NAV_HEIGHT,
    getItemKey,
    enabled: containerWidth > 0
  })
  const scrollToIndex = virtualizer.scrollToIndex

  const updateMeasurements = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const horizontalInset = window.innerWidth >= 640 ? 16 : 0
    const nextWidth = Math.max(1, rect.width - horizontalInset)
    const nextScrollMargin = rect.top + window.scrollY
    setContainerWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth))
    setScrollMargin((currentMargin) => (currentMargin === nextScrollMargin ? currentMargin : nextScrollMargin))
  }, [])

  useLayoutEffect(() => {
    updateMeasurements()
    if (!containerRef.current) return

    const resizeObserver = new ResizeObserver(updateMeasurements)
    resizeObserver.observe(containerRef.current)
    window.addEventListener('resize', updateMeasurements)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateMeasurements)
    }
  }, [updateMeasurements])

  useEffect(() => {
    const targetIndex = pendingScrollIndexRef.current
    if (!isExpanded || targetIndex === null) return

    const frame = requestAnimationFrame(() => {
      scrollToIndex(targetIndex, { align: 'start', behavior: 'auto' })
      pendingScrollIndexRef.current = null
    })

    return () => cancelAnimationFrame(frame)
  }, [isExpanded, scrollToIndex, visibleCount])

  const canPreviewFullSize = useCallback((media: ArtworkImageResponseDto) => {
    return media.mediaType !== 'video' && !isVideoFile(media.path)
  }, [])

  const handleOpenMenu = useCallback((e: React.MouseEvent | React.TouchEvent, index: number) => {
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

  const handlePreview = useCallback(() => {
    if (!contextMenu) return

    setStoreImages(images)
    setContextMenu(null)
    router.push(`/artworks/preview?index=${contextMenu.index}`)
  }, [contextMenu, images, router, setStoreImages])

  const handleAnchorSelect = useCallback(
    (index: number) => {
      setCurrentIndex(index)
      setIsMobileNavigationOpen(false)

      if (!isExpanded && index >= MAX_PREVIEW_IMAGES) {
        pendingScrollIndexRef.current = index
        setIsExpanded(true)
        return
      }

      scrollToIndex(index, { align: 'start', behavior: 'auto' })
    },
    [isExpanded, scrollToIndex, setCurrentIndex]
  )

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

  return (
    <>
      <div
        ref={containerRef}
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
        data-testid="artwork-images-container"
        data-expanded={isExpanded ? 'true' : 'false'}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const index = virtualItem.index
          const media = images[index]!
          const isLastPreview = !isExpanded && images.length > MAX_PREVIEW_IMAGES && index === MAX_PREVIEW_IMAGES - 1

          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={index}
              className="absolute left-0 right-0 top-0 sm:left-2 sm:right-2"
              style={{
                transform: `translateY(${virtualItem.start - scrollMargin}px)`
              }}
            >
              <div className="relative group">
                <ImageWrapper index={index} previewEnabled={canPreviewFullSize(media)} onOpenMenu={handleOpenMenu}>
                  <LazyMedia media={media} index={index} />
                </ImageWrapper>

                {isLastPreview && (
                  <div className="absolute bottom-0 left-0 right-0 z-10 flex h-64 items-end justify-center bg-gradient-to-t from-white via-white/90 to-transparent">
                    <Button
                      variant="secondary"
                      onClick={() => setIsExpanded(true)}
                      className="h-12 w-full min-w-[240px] rounded-full px-8 text-base font-medium shadow-sm transition-all hover:bg-gray-200 md:w-auto"
                    >
                      查看剩余 {remainingCount} 张图片
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {anchorIndexes.length > 0 && (
        <>
          <MediaAnchorList
            indexes={anchorIndexes}
            activeIndex={activeAnchorIndex}
            onSelect={handleAnchorSelect}
            className="fixed right-4 top-1/2 z-40 hidden -translate-y-1/2 md:block"
          />

          <button
            type="button"
            aria-label={isMobileNavigationOpen ? '关闭媒体快捷导航' : '打开媒体快捷导航'}
            aria-expanded={isMobileNavigationOpen}
            onClick={() => setIsMobileNavigationOpen((open) => !open)}
            className="fixed bottom-20 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg md:hidden"
          >
            {isMobileNavigationOpen ? <X className="h-5 w-5" /> : <ListTree className="h-5 w-5" />}
          </button>

          {isMobileNavigationOpen && (
            <MediaAnchorList
              indexes={anchorIndexes}
              activeIndex={activeAnchorIndex}
              onSelect={handleAnchorSelect}
              className="fixed bottom-32 right-4 z-40 md:hidden"
            />
          )}
        </>
      )}

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
          className="w-auto rounded-[4px] border border-[#E5E5E5] bg-white p-1 shadow-[0_8px_16px_rgba(0,0,0,0.1)] duration-150 ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div
            onClick={handlePreview}
            className="cursor-pointer select-none rounded-[2px] px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
          >
            预览完整尺寸
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
