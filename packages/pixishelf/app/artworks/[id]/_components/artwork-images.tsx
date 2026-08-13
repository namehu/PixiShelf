'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { ListTree, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import LazyMedia from './lazy-media'
import { useLongPress } from '@/hooks/use-long-press'
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover'
import { useRouter } from 'next/navigation'
import { useArtworkStore } from '@/store/use-artwork-store'
import { useArtworkMediaAnchorInterval } from '@/components/user-setting'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { isApngFile, isGifFile, isVideoFile, isWebpFile } from '@/lib/media'
import { cn } from '@/lib/utils'
import AdaptiveMediaPreview from './adaptive-media-preview'
import { ArtworkVideoOptimizationProvider } from './artwork-video-optimization-context'

interface ArtworkImagesProps {
  images: ArtworkImageResponseDto[]
  artworkId: number
}

const MAX_PREVIEW_IMAGES = 20
const NAV_HEIGHT = 64

type PreviewMenuState = { x: number; y: number; index: number }

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

function canPreviewFullSize(media: ArtworkImageResponseDto) {
  return media.mediaType !== 'video' && !isVideoFile(media.path)
}

function isVideoMedia(media: ArtworkImageResponseDto) {
  return media.mediaType === 'video' || isVideoFile(media.path)
}

function usesInteractiveMediaPlayer(media: ArtworkImageResponseDto) {
  if (isVideoMedia(media) || isWebpFile(media.path)) return true
  if (!media.isAnimated) return false

  return isApngFile(media.path) || isGifFile(media.path) || /\.png$/i.test(media.path)
}

function isSingleVideoArtwork(images: ArtworkImageResponseDto[]) {
  return images.length === 1 && isVideoMedia(images[0]!)
}

function getPointerPosition(event: React.MouseEvent | React.TouchEvent) {
  if ('touches' in event) {
    const touch = event.touches[0]
    return touch ? { x: touch.clientX, y: touch.clientY } : null
  }

  return { x: event.clientX, y: event.clientY }
}

function useMeasuredMediaContainer() {
  const [containerWidth, setContainerWidth] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

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

  return { containerRef, containerWidth, scrollMargin }
}

function useArtworkMediaVirtualizer({
  images,
  isExpanded,
  containerWidth,
  scrollMargin
}: {
  images: ArtworkImageResponseDto[]
  isExpanded: boolean
  containerWidth: number
  scrollMargin: number
}) {
  const visibleCount = isExpanded ? images.length : Math.min(images.length, MAX_PREVIEW_IMAGES)
  const remainingCount = Math.max(0, images.length - MAX_PREVIEW_IMAGES)

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

  return { virtualizer, visibleCount, remainingCount }
}

function usePreviewContextMenu(images: ArtworkImageResponseDto[], onOpenAdaptivePreview: (index: number) => void) {
  const [contextMenu, setContextMenu] = useState<PreviewMenuState | null>(null)
  const router = useRouter()
  const setStoreImages = useArtworkStore((state) => state.setImages)

  const openContextMenu = useCallback((event: React.MouseEvent | React.TouchEvent, index: number) => {
    const position = getPointerPosition(event)
    if (!position) return

    setContextMenu({ ...position, index })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const previewSelectedMedia = useCallback(() => {
    if (!contextMenu) return

    onOpenAdaptivePreview(contextMenu.index)
    setContextMenu(null)
  }, [contextMenu, onOpenAdaptivePreview])

  const viewOriginalSelectedMedia = useCallback(() => {
    if (!contextMenu) return

    setStoreImages(images)
    setContextMenu(null)
    router.push(`/artworks/preview?index=${contextMenu.index}`)
  }, [contextMenu, images, router, setStoreImages])

  useEffect(() => {
    const handleClose = () => {
      closeContextMenu()
    }

    window.addEventListener('scroll', handleClose, { capture: true })
    window.addEventListener('resize', handleClose)

    return () => {
      window.removeEventListener('scroll', handleClose, { capture: true })
      window.removeEventListener('resize', handleClose)
    }
  }, [closeContextMenu])

  return {
    contextMenu,
    openContextMenu,
    closeContextMenu,
    previewSelectedMedia,
    viewOriginalSelectedMedia
  }
}

function PreviewableMedia({
  children,
  index,
  enabled,
  tapPreviewEnabled,
  onOpenMenu,
  onPreview
}: {
  children: ReactNode
  index: number
  enabled: boolean
  tapPreviewEnabled: boolean
  onOpenMenu: (e: React.MouseEvent | React.TouchEvent, index: number) => void
  onPreview: (index: number) => void
}) {
  const { ...longPressProps } = useLongPress({
    onLongPress: (e) => onOpenMenu(e, index),
    onClick: tapPreviewEnabled ? () => onPreview(index) : undefined,
    threshold: 500
  })

  if (!enabled) return children

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

function ArtworkMediaItem({
  media,
  index,
  showExpandOverlay,
  remainingCount,
  onExpand,
  onOpenPreviewMenu,
  onOpenAdaptivePreview,
  highlighted
}: {
  media: ArtworkImageResponseDto
  index: number
  showExpandOverlay: boolean
  remainingCount: number
  onExpand: () => void
  onOpenPreviewMenu: (e: React.MouseEvent | React.TouchEvent, index: number) => void
  onOpenAdaptivePreview: (index: number) => void
  highlighted: boolean
}) {
  return (
    <div
      className={cn(
        'relative group transition-[box-shadow] duration-300',
        highlighted && 'z-[1] ring-4 ring-blue-500/75 ring-offset-2 ring-offset-white'
      )}
      data-preview-highlighted={highlighted ? 'true' : undefined}
    >
      <PreviewableMedia
        index={index}
        enabled={!isVideoMedia(media)}
        tapPreviewEnabled={canPreviewFullSize(media) && !usesInteractiveMediaPlayer(media)}
        onOpenMenu={onOpenPreviewMenu}
        onPreview={onOpenAdaptivePreview}
      >
        <LazyMedia media={media} index={index} />
      </PreviewableMedia>

      {showExpandOverlay && <ExpandRemainingMediaButton remainingCount={remainingCount} onExpand={onExpand} />}
    </div>
  )
}

function ExpandRemainingMediaButton({ remainingCount, onExpand }: { remainingCount: number; onExpand: () => void }) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-10 flex h-64 items-end justify-center bg-gradient-to-t from-white via-white/90 to-transparent">
      <Button
        variant="secondary"
        onClick={onExpand}
        className="h-12 w-full min-w-[240px] rounded-full px-8 text-base font-medium shadow-sm transition-all hover:bg-gray-200 md:w-auto"
      >
        查看剩余 {remainingCount} 张图片
      </Button>
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

function MediaAnchorNavigation({
  indexes,
  activeIndex,
  isMobileOpen,
  onMobileOpenChange,
  onSelect
}: {
  indexes: number[]
  activeIndex: number
  isMobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
  onSelect: (index: number) => void
}) {
  if (indexes.length === 0) return null

  return (
    <>
      <MediaAnchorList
        indexes={indexes}
        activeIndex={activeIndex}
        onSelect={onSelect}
        className="fixed right-4 top-1/2 z-40 hidden -translate-y-1/2 md:block"
      />

      <button
        type="button"
        aria-label={isMobileOpen ? '关闭媒体快捷导航' : '打开媒体快捷导航'}
        aria-expanded={isMobileOpen}
        onClick={() => onMobileOpenChange(!isMobileOpen)}
        className="fixed right-4 bottom-[calc(var(--app-mobile-navigation-offset)+1rem)] z-40 flex h-11 w-11 items-center justify-center rounded-full bg-foreground text-background shadow-floating md:hidden"
      >
        {isMobileOpen ? <X className="h-5 w-5" /> : <ListTree className="h-5 w-5" />}
      </button>

      {isMobileOpen && (
        <MediaAnchorList
          indexes={indexes}
          activeIndex={activeIndex}
          onSelect={onSelect}
          className="fixed right-4 bottom-[calc(var(--app-mobile-navigation-offset)+4rem)] z-40 md:hidden"
        />
      )}
    </>
  )
}

function PreviewContextMenu({
  contextMenu,
  images,
  onOpenChange,
  onPreview,
  onViewOriginal
}: {
  contextMenu: PreviewMenuState | null
  images: ArtworkImageResponseDto[]
  onOpenChange: (open: boolean) => void
  onPreview: () => void
  onViewOriginal: () => void
}) {
  const selectedMedia = contextMenu ? images[contextMenu.index] : null

  return (
    <Popover open={!!contextMenu} onOpenChange={onOpenChange}>
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
        <button
          type="button"
          onClick={onPreview}
          className="block w-full cursor-pointer select-none rounded-[2px] px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100"
        >
          适配尺寸预览
        </button>
        {selectedMedia && canPreviewFullSize(selectedMedia) && (
          <button
            type="button"
            onClick={onViewOriginal}
            className="block w-full cursor-pointer select-none rounded-[2px] px-4 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100"
          >
            查看原始文件
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function SingleVideoArtworkMedia({ media }: { media: ArtworkImageResponseDto }) {
  return (
    <div className="w-full sm:px-2" data-testid="artwork-video-container">
      <LazyMedia media={media} index={0} />
    </div>
  )
}

function VirtualizedArtworkMediaList({
  images,
  returnIndex,
  onReturnHandled,
  onOpenPreviewMenu,
  onOpenAdaptivePreview
}: {
  images: ArtworkImageResponseDto[]
  returnIndex: number | null
  onReturnHandled: () => void
  onOpenPreviewMenu: (e: React.MouseEvent | React.TouchEvent, index: number) => void
  onOpenAdaptivePreview: (index: number) => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const pendingScrollIndexRef = useRef<number | null>(null)
  const anchorInterval = useArtworkMediaAnchorInterval()
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const currentIndex = useArtworkStore((state) => state.currentIndex)
  const { containerRef, containerWidth, scrollMargin } = useMeasuredMediaContainer()
  const { virtualizer, visibleCount, remainingCount } = useArtworkMediaVirtualizer({
    images,
    isExpanded,
    containerWidth,
    scrollMargin
  })

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

  const scrollToIndex = virtualizer.scrollToIndex

  useEffect(() => {
    if (returnIndex === null) return

    setCurrentIndex(returnIndex)
    setIsMobileNavigationOpen(false)

    if (!isExpanded && returnIndex >= MAX_PREVIEW_IMAGES) {
      setIsExpanded(true)
      return
    }

    const frame = requestAnimationFrame(() => {
      scrollToIndex(returnIndex, { align: 'start', behavior: 'auto' })
      setHighlightedIndex(returnIndex)
      onReturnHandled()
    })

    return () => cancelAnimationFrame(frame)
  }, [isExpanded, onReturnHandled, returnIndex, scrollToIndex, setCurrentIndex])

  useEffect(() => {
    if (highlightedIndex === null) return

    const timeout = window.setTimeout(() => setHighlightedIndex(null), 1200)
    return () => window.clearTimeout(timeout)
  }, [highlightedIndex])

  useEffect(() => {
    const targetIndex = pendingScrollIndexRef.current
    if (!isExpanded || targetIndex === null) return

    const frame = requestAnimationFrame(() => {
      scrollToIndex(targetIndex, { align: 'start', behavior: 'auto' })
      pendingScrollIndexRef.current = null
    })

    return () => cancelAnimationFrame(frame)
  }, [isExpanded, scrollToIndex, visibleCount])

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
              <ArtworkMediaItem
                media={media}
                index={index}
                showExpandOverlay={isLastPreview}
                remainingCount={remainingCount}
                onExpand={() => setIsExpanded(true)}
                onOpenPreviewMenu={onOpenPreviewMenu}
                onOpenAdaptivePreview={onOpenAdaptivePreview}
                highlighted={highlightedIndex === index}
              />
            </div>
          )
        })}
      </div>

      <MediaAnchorNavigation
        indexes={anchorIndexes}
        activeIndex={activeAnchorIndex}
        isMobileOpen={isMobileNavigationOpen}
        onMobileOpenChange={setIsMobileNavigationOpen}
        onSelect={handleAnchorSelect}
      />
    </>
  )
}

export default function ArtworkImages({ images }: ArtworkImagesProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [returnIndex, setReturnIndex] = useState<number | null>(null)
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const adaptivePreviewImages = useMemo(() => images.filter((media) => !isVideoMedia(media)), [images])
  const openAdaptivePreview = useCallback(
    (originalIndex: number) => {
      const media = images[originalIndex]
      if (!media || isVideoMedia(media)) return
      const filteredIndex = adaptivePreviewImages.findIndex((candidate) => candidate.id === media.id)
      if (filteredIndex >= 0) setPreviewIndex(filteredIndex)
    },
    [adaptivePreviewImages, images]
  )
  const { contextMenu, openContextMenu, closeContextMenu, previewSelectedMedia, viewOriginalSelectedMedia } =
    usePreviewContextMenu(images, openAdaptivePreview)

  const handlePreviewClose = useCallback(
    (finalIndex: number) => {
      const returnedMedia = adaptivePreviewImages[finalIndex]
      const originalIndex = returnedMedia ? images.findIndex((media) => media.id === returnedMedia.id) : -1
      setPreviewIndex(null)
      if (originalIndex < 0) return
      setCurrentIndex(originalIndex)
      setReturnIndex(originalIndex)
    },
    [adaptivePreviewImages, images, setCurrentIndex]
  )

  const handleReturnHandled = useCallback(() => setReturnIndex(null), [])

  const mediaContent = isSingleVideoArtwork(images) ? (
    <SingleVideoArtworkMedia media={images[0]!} />
  ) : (
    <VirtualizedArtworkMediaList
      images={images}
      returnIndex={returnIndex}
      onReturnHandled={handleReturnHandled}
      onOpenPreviewMenu={openContextMenu}
      onOpenAdaptivePreview={openAdaptivePreview}
    />
  )

  const videoImageIds = useMemo(() => images.filter(isVideoMedia).map((media) => media.id), [images])

  return (
    <ArtworkVideoOptimizationProvider imageIds={videoImageIds}>
      {mediaContent}
      <PreviewContextMenu
        contextMenu={contextMenu}
        images={images}
        onOpenChange={(open) => {
          if (!open) closeContextMenu()
        }}
        onPreview={previewSelectedMedia}
        onViewOriginal={viewOriginalSelectedMedia}
      />
      {previewIndex !== null && (
        <AdaptiveMediaPreview
          images={adaptivePreviewImages}
          initialIndex={previewIndex}
          open
          onClose={handlePreviewClose}
        />
      )}
    </ArtworkVideoOptimizationProvider>
  )
}
