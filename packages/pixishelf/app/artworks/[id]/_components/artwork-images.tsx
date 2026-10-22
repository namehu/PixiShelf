'use client'

import { MediaDetailsPlaceholder, useReaderMediaWindow, useArtworkReader } from '@/lib/reading/artwork-reader-provider'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import {
  getArtworkDisplayPolicy,
  useArtworkDetailPreferences,
  useArtworkDetailPreferencesReady
} from '@/store/use-artwork-detail-preferences'
import { Button } from '@/components/ui/button'
import LazyMedia from './lazy-media'
import { ReadingMediaStatus, readingMediaPosition } from './reading-media-status'
import { useLongPress } from '@/hooks/use-long-press'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useRouter } from 'next/navigation'
import { useArtworkStore } from '@/store/use-artwork-store'
import { useArtworkMediaAnchorInterval } from '@/components/user-setting'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { isApngFile, isGifFile, isVideoFile, isWebpFile } from '@/lib/media'
import { hasReliableSingleFrameDimensions } from '@/lib/media-animation'
import { cn } from '@/lib/utils'
import { MediaAnchorNavigation } from './media-anchor-navigation'
import { ArtworkFloatingPortal, useArtworkDetailControls } from './artwork-detail-controls'
import AdaptiveMediaPreview from './adaptive-media-preview'
import { ArtworkVideoOptimizationProvider } from './artwork-video-optimization-context'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { useAutoBrowseInterruption } from './use-auto-browse-interruption'
import { getAutoBrowseViewport, useArtworkAutoScroll } from './use-artwork-auto-scroll'
import { AutoBrowseControls } from './auto-browse-controls'
import { useArtworkVideoPlayback } from './use-artwork-video-playback'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import { ArtworkStackCard } from './artwork-stack-card'
import { useArtworkStackSlideshow } from './use-artwork-stack-slideshow'
import { useArtworkSummary } from './artwork-summary-context'
import type { StackDecoration } from './artwork-stack-projection'
import { getArtworkMediaRange } from './artwork-media-range'
import { MediaMarkActions } from '@/components/media-mark/media-mark-actions'
import { MoreHorizontalIcon } from 'lucide-react'

interface ArtworkImagesProps {
  images: ArtworkImageResponseDto[]
  allImages?: ArtworkImageResponseDto[]
  summaryMode?: boolean
  summaryDecorations?: Map<number, StackDecoration>
  artworkId: number
  reading?: ArtworkReadingHandle
  trackingActive?: boolean
  continueRequest?: { index: number; nonce: number } | null
  onContinueHandled?: () => void
}

const NAV_HEIGHT = 64

type PreviewMenuState = { x: number; y: number; index: number; loadFailed: boolean }
type AdaptivePreviewState = { index: number; initialPreviewSrc?: string }

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

export function getEstimatedMediaHeight(media: ArtworkImageResponseDto, containerWidth: number) {
  const width = containerWidth || 656
  if (
    (media.reliableDimensions ?? hasReliableSingleFrameDimensions(media)) &&
    media.width &&
    media.height &&
    media.width > 0 &&
    media.height > 0
  ) {
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

function keepsSurfacePlaybackControl(media: ArtworkImageResponseDto) {
  if (isVideoMedia(media)) return true
  if (isWebpFile(media.path)) return false
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

// Section spacing, paper edges and the compact navigation below the image.
const STACK_ROW_CHROME_HEIGHT = 60

function useMeasuredMediaContainer() {
  const [containerWidth, setContainerWidth] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [stackHeight, setStackHeight] = useState((800 - NAV_HEIGHT) * 0.9 - STACK_ROW_CHROME_HEIGHT)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [scrollPaddingStart, setScrollPaddingStart] = useState(NAV_HEIGHT)
  const containerRef = useRef<HTMLDivElement>(null)

  const updateMeasurements = useCallback(() => {
    if (!containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const nextWidth = Math.max(1, rect.width)
    const nextScrollMargin = rect.top + window.scrollY
    const { top, bottom } = getAutoBrowseViewport()

    setContainerWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth))
    setViewportHeight(window.innerHeight)
    setScrollMargin((currentMargin) => (currentMargin === nextScrollMargin ? currentMargin : nextScrollMargin))
    setScrollPaddingStart(top)
    // A landscape cover must not squeeze every portrait in its stack into a short frame.
    setStackHeight(Math.max(160, (bottom - top) * 0.9 - STACK_ROW_CHROME_HEIGHT))
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

  return { containerRef, containerWidth, viewportHeight, stackHeight, scrollMargin, scrollPaddingStart }
}

function useArtworkMediaVirtualizer({
  images,
  visibleCount,
  containerWidth,
  viewportHeight,
  stackHeight,
  scrollMargin,
  scrollPaddingStart,
  decorations
}: {
  images: ArtworkImageResponseDto[]
  visibleCount: number
  containerWidth: number
  viewportHeight: number
  stackHeight: number
  scrollMargin: number
  scrollPaddingStart: number
  decorations?: Map<number, StackDecoration>
}) {
  const estimateSize = useCallback(
    (index: number) => {
      const image = images[index]!
      const stack = decorations?.get(image.id)
      return stack && stack.group.mediaIds.length > 1
        ? stackHeight + STACK_ROW_CHROME_HEIGHT
        : getEstimatedMediaHeight(image, containerWidth)
    },
    [containerWidth, images, decorations, stackHeight]
  )
  const getItemKey = useCallback(
    (index: number) => decorations?.get(images[index]?.id ?? -1)?.group.id ?? images[index]?.id ?? index,
    [images, decorations]
  )
  const identity = images.map((media) => decorations?.get(media.id)?.group.id ?? media.id).join(',')
  const measuredSizes = useMemo(() => new Map<number, number>(), [containerWidth, identity])
  const [measurementRevision, setMeasurementRevision] = useState(0)
  const rangeExtractor = useMemo(
    () => (range: Parameters<typeof getArtworkMediaRange>[0]) =>
      getArtworkMediaRange(range, viewportHeight, (index) => measuredSizes.get(index) ?? estimateSize(index)),
    // A resize can change the preload distance without changing the visible indexes.
    [viewportHeight, estimateSize, measuredSizes, measurementRevision]
  )
  const measureSize = useCallback(
    (element: HTMLDivElement, entry: ResizeObserverEntry | undefined) => {
      const size = Math.round(entry?.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight)
      const index = Number(element.dataset.index)
      if (size > 0 && measuredSizes.get(index) !== size) {
        measuredSizes.set(index, size)
        setMeasurementRevision((value) => value + 1)
      }
      return size
    },
    [measuredSizes]
  )

  const virtualizer = useWindowVirtualizer({
    useFlushSync: false,
    count: visibleCount,
    estimateSize,
    rangeExtractor,
    measureElement: measureSize,
    scrollMargin,
    scrollPaddingStart,
    getItemKey,
    enabled: containerWidth > 0
  })

  const pendingElements = useRef(new Set<HTMLDivElement>())
  const measurementFrame = useRef<number | null>(null)
  const measureElement = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) {
        virtualizer.measureElement(null)
        return
      }
      pendingElements.current.add(element)
      if (measurementFrame.current !== null) return

      // Ref 测量会同步更新虚拟范围；展开大量短媒体时，逐批挂载会超过 React 嵌套更新上限。
      // 将同一轮挂载合并到下一帧，仍由 virtualizer 观察后续真实尺寸变化。
      measurementFrame.current = requestAnimationFrame(() => {
        measurementFrame.current = null
        const elements = [...pendingElements.current]
        pendingElements.current.clear()
        for (const node of elements) {
          if (node.isConnected) virtualizer.measureElement(node)
        }
      })
    },
    [virtualizer]
  )

  useLayoutEffect(
    () => () => {
      if (measurementFrame.current !== null) cancelAnimationFrame(measurementFrame.current)
      measurementFrame.current = null
      pendingElements.current.clear()
    },
    []
  )

  return { virtualizer, measureElement }
}

function usePreviewContextMenu(
  images: ArtworkImageResponseDto[],
  allImages: ArtworkImageResponseDto[],
  artworkId: number,
  onOpenAdaptivePreview: (index: number) => void,
  reading?: ArtworkReadingHandle
) {
  const [contextMenu, setContextMenu] = useState<PreviewMenuState | null>(null)
  const router = useRouter()
  const setStoreImages = useArtworkStore((state) => state.setImages)

  const openContextMenu = useCallback(
    (event: React.MouseEvent | React.TouchEvent, index: number, loadFailed = false) => {
      const position = getPointerPosition(event)
      if (!position) return
      useArtworkAutoBrowseStore.getState().pause('overlay')

      setContextMenu({ ...position, index, loadFailed })
    },
    []
  )

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const previewSelectedMedia = useCallback(() => {
    if (!contextMenu) return

    onOpenAdaptivePreview(contextMenu.index)
    setContextMenu(null)
  }, [contextMenu, onOpenAdaptivePreview])

  const viewOriginalSelectedMedia = useCallback(() => {
    if (!contextMenu) return
    const selected = images[contextMenu.index]
    if (!selected) return
    const originalIndex =
      readingMediaPosition(reading, selected.id)?.index ?? allImages.findIndex((media) => media.id === selected.id)
    if (originalIndex < 0) return
    setStoreImages(allImages)
    setContextMenu(null)
    router.push(`/artworks/preview?artworkId=${artworkId}&index=${originalIndex}`)
  }, [artworkId, contextMenu, images, allImages, reading, router, setStoreImages])

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
  onPreview: (index: number, initialPreviewSrc?: string) => void
}) {
  const { ...longPressProps } = useLongPress({
    onLongPress: (e) => onOpenMenu(e, index),
    onClick: tapPreviewEnabled
      ? (event) => {
          const image = event.currentTarget.querySelector('img')
          const initialPreviewSrc = image?.currentSrc || image?.src || undefined
          onPreview(index, initialPreviewSrc)
        }
      : undefined,
    threshold: 500
  })

  if (!enabled) return children

  return (
    <div
      {...longPressProps}
      onContextMenu={(event) => { event.preventDefault(); onOpenMenu(event, index) }}
      className="select-none [&_img]:pointer-events-none [&_img]:[-webkit-touch-callout:none]"
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
    >
      {children}
    </div>
  )
}

const ArtworkMediaItem = memo(function ArtworkMediaItem({
  media,
  index,
  onOpenPreviewMenu,
  onOpenAdaptivePreview,
  highlighted,
  autoMode = 'scroll',
  reading,
  trackingActive
}: {
  media: ArtworkImageResponseDto
  index: number
  onOpenPreviewMenu: (e: React.MouseEvent | React.TouchEvent, index: number, loadFailed?: boolean) => void
  onOpenAdaptivePreview: (index: number, initialPreviewSrc?: string) => void
  highlighted: boolean
  autoMode?: 'scroll' | 'slideshow'
  reading?: ArtworkReadingHandle
  trackingActive: boolean
}) {
  const [loadFailed, setLoadFailed] = useState(false)
  const onPreviewStatusChange = useCallback(
    (status: 'loading' | 'ready' | 'error') => setLoadFailed(status === 'error'),
    []
  )
  const onOpenMenu = useCallback(
    (event: React.MouseEvent | React.TouchEvent, itemIndex: number) => onOpenPreviewMenu(event, itemIndex, loadFailed),
    [onOpenPreviewMenu, loadFailed]
  )
  if (media.detailsPending) return <MediaDetailsPlaceholder media={media} index={index} />
  return (
    <div
      className={cn(
        'group relative transition-[box-shadow] duration-(--motion-base)',
        highlighted && 'z-[1] ring-4 ring-ring/70 ring-offset-2 ring-offset-background'
      )}
      data-preview-highlighted={highlighted ? 'true' : undefined}
      onContextMenu={isVideoMedia(media) ? (event) => { event.preventDefault(); onOpenMenu(event, index) } : undefined}
    >
      <PreviewableMedia
        index={index}
        enabled={!isVideoMedia(media)}
        tapPreviewEnabled={canPreviewFullSize(media) && !keepsSurfacePlaybackControl(media)}
        onOpenMenu={onOpenMenu}
        onPreview={onOpenAdaptivePreview}
      >
        <LazyMedia
          autoMode={autoMode}
          onPreviewStatusChange={onPreviewStatusChange}
          media={media}
          index={index}
          reading={reading}
          trackingActive={trackingActive}
        />
      </PreviewableMedia>
      {isVideoMedia(media) ? <VideoMediaMenuButton onOpenMenu={(event) => onOpenMenu(event, index)} /> : null}
    </div>
  )
})

function ExpandRemainingMediaButton({ remainingCount, onExpand }: { remainingCount: number; onExpand: () => void }) {
  return (
    <div className="flex justify-center py-3">
      <Button
        variant="secondary"
        onClick={onExpand}
        className="h-12 w-full min-w-[240px] rounded-full px-8 text-base font-medium shadow-surface md:w-auto"
      >
        查看剩余 {remainingCount} 张图片
      </Button>
    </div>
  )
}

function PreviewContextMenu({
  contextMenu,
  images,
  onOpenChange,
  onPreview,
  onAutoScroll,
  onViewOriginal,
  reading,
  stackMode = false
}: {
  stackMode?: boolean
  contextMenu: PreviewMenuState | null
  reading?: ArtworkReadingHandle
  images: ArtworkImageResponseDto[]
  onOpenChange: (open: boolean) => void
  onPreview: () => void
  onAutoScroll: () => void
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
        className="w-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-floating duration-(--motion-fast) ease-out data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
      >
        {selectedMedia && (
          <ReadingMediaStatus reading={reading} mediaId={selectedMedia.id} loadFailed={contextMenu?.loadFailed} />
        )}
        {selectedMedia ? <MediaMarkActions artworkId={selectedMedia.artworkId ?? 0} mediaId={selectedMedia.id} layout="menu" /> : null}
        {selectedMedia && !isVideoMedia(selectedMedia) && (
          <Button variant="ghost" className="min-h-11 w-full justify-start" onClick={onAutoScroll}>
            {stackMode ? '自动翻阅' : '自动滚动'}
          </Button>
        )}
        {selectedMedia && !isVideoMedia(selectedMedia) && <button
          type="button"
          onClick={onPreview}
          className="block min-h-10 w-full cursor-pointer select-none rounded-sm px-4 py-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
        >
          适配尺寸预览
        </button>}
        {selectedMedia && canPreviewFullSize(selectedMedia) && (
          <button
            type="button"
            onClick={onViewOriginal}
            className="block min-h-10 w-full cursor-pointer select-none rounded-sm px-4 py-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
          >
            查看原始文件
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function SingleVideoArtworkMedia({
  media,
  reading,
  trackingActive,
  onOpenMenu
}: {
  media: ArtworkImageResponseDto
  reading?: ArtworkReadingHandle
  trackingActive: boolean
  onOpenMenu: (event: React.MouseEvent | React.TouchEvent, index: number) => void
}) {
  return (
    <div className="relative w-full" data-testid="artwork-video-container"
      onContextMenu={(event) => { event.preventDefault(); onOpenMenu(event, 0) }}>
      <LazyMedia media={media} index={0} reading={reading} trackingActive={trackingActive} />
      <VideoMediaMenuButton onOpenMenu={(event) => onOpenMenu(event, 0)} />
    </div>
  )
}

function VideoMediaMenuButton({ onOpenMenu }: { onOpenMenu: (event: React.MouseEvent) => void }) {
  return <div className="flex justify-end py-1">
    <Button type="button" variant="ghost" className="min-h-11" onClick={onOpenMenu}>
      <MoreHorizontalIcon data-icon="inline-start" aria-hidden="true" />图片操作
    </Button>
  </div>
}

function VirtualizedArtworkMediaList({
  images,
  allImages,
  returnIndex,
  onReturnHandled,
  onOpenPreviewMenu,
  onOpenAdaptivePreview,
  reading,
  trackingActive,
  summaryMode = false,
  summaryDecorations
}: {
  summaryMode?: boolean
  summaryDecorations?: Map<number, StackDecoration>
  allImages: ArtworkImageResponseDto[]
  images: ArtworkImageResponseDto[]
  returnIndex: number | null
  onReturnHandled: () => void
  onOpenPreviewMenu: (e: React.MouseEvent | React.TouchEvent, index: number, loadFailed?: boolean) => void
  onOpenAdaptivePreview: (index: number, initialPreviewSrc?: string) => void
  reading?: ArtworkReadingHandle
  trackingActive: boolean
}) {
  const reader = useArtworkReader()
  const detailControls = useArtworkDetailControls()
  const mediaIndexReady = !reader || Boolean(reader.initialization)
  const summary = useArtworkSummary()
  const total = images.length
  const originalIndexes = images.map((media, index) => readingMediaPosition(reading, media.id)?.index ?? index)
  const originalTotal = reading?.context?.media.length ?? total
  const [isExpanded, setIsExpanded] = useState(false)
  const previewCount = useArtworkDetailPreferences((state) => state.previewCount)
  const policy = getArtworkDisplayPolicy(total, previewCount, isExpanded)
  const { collapsible, visibleCount, remainingCount, fullyVisible } = summaryMode
    ? { collapsible: false, visibleCount: images.length, remainingCount: 0, fullyVisible: true }
    : policy
  const collapsePendingRef = useRef(false)
  const collapsedFooterRef = useRef<HTMLDivElement>(null)
  const [isNavigationOpen, setIsNavigationOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const [retryCounts, setRetryCounts] = useState<Record<number, number>>({})
  const autoMode = useArtworkAutoBrowseStore((state) => state.mode)
  const previewOpen = useArtworkAutoBrowseStore((state) => state.previewOpen)
  const driverMode = summaryMode ? 'slideshow' : 'scroll'
  const showAutoControls = autoMode === driverMode && !previewOpen
  const pendingScrollIndexRef = useRef<number | null>(null)
  const anchorInterval = useArtworkMediaAnchorInterval()
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const currentIndex = useArtworkStore((state) => state.currentIndex)
  const { containerRef, containerWidth, viewportHeight, stackHeight, scrollMargin, scrollPaddingStart } =
    useMeasuredMediaContainer()
  const { virtualizer, measureElement } = useArtworkMediaVirtualizer({
    images,
    visibleCount: Math.min(visibleCount, images.length),
    containerWidth,
    viewportHeight,
    stackHeight,
    scrollMargin,
    scrollPaddingStart,
    decorations: summaryDecorations
  })
  const virtualItems = virtualizer.getVirtualItems()
  useReaderMediaWindow(
    'detail',
    virtualItems.flatMap((item) => {
      const media = images[item.index]!
      const group = summaryDecorations?.get(media.id)
      return group ? group.mediaIds.slice(Math.max(0, group.activeIndex - 1), group.activeIndex + 2) : [media.id]
    }),
    trackingActive || Boolean(summary?.navigating)
  )
  const expand = useCallback(() => setIsExpanded(true), [])
  // 自动滚动只关心是否能浏览完整作品，自然全显不需要再触发主动展开。
  useArtworkAutoScroll({ containerRef, images, expanded: fullyVisible, expand, ready: mediaIndexReady && !summaryMode })
  useArtworkStackSlideshow({
    images: allImages,
    containerRef,
    enabled: summaryMode && mediaIndexReady && trackingActive
  })

  const toggleExpanded = useCallback(() => {
    // 先结束自动滚动并清除选页/预览返回的待定位，防止收起后又被旧任务展开。
    useArtworkAutoBrowseStore.getState().stop()
    pendingScrollIndexRef.current = null
    onReturnHandled()
    setHighlightedIndex(null)
    setIsNavigationOpen(false)
    if (isExpanded) {
      collapsePendingRef.current = true
      setCurrentIndex(Math.min(images.length, previewCount) - 1)
    }
    setIsExpanded((value) => !value)
  }, [images.length, isExpanded, onReturnHandled, previewCount, setCurrentIndex])

  const backToTop = useCallback(() => {
    useArtworkAutoBrowseStore.getState().pause('manual')
    pendingScrollIndexRef.current = null
    collapsePendingRef.current = false
    onReturnHandled()
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [onReturnHandled])

  useEffect(() => {
    if (isExpanded || !collapsePendingRef.current) return
    let followup = 0
    // 缩短虚拟列表后先定位最后一项，下一帧再露出底部展开入口。
    // 两帧都检查取消标记，避免覆盖用户随后执行的选页或回顶部操作。
    const frame = requestAnimationFrame(() => {
      if (!collapsePendingRef.current) return
      virtualizer.scrollToIndex(Math.max(0, visibleCount - 1), { align: 'end', behavior: 'auto' })
      followup = requestAnimationFrame(() => {
        if (!collapsePendingRef.current) return
        collapsedFooterRef.current?.scrollIntoView({ block: 'end', behavior: 'instant' })
        collapsePendingRef.current = false
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(followup)
    }
  }, [isExpanded, virtualizer, visibleCount])

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
    setIsNavigationOpen(false)

    if (!fullyVisible && returnIndex >= visibleCount) {
      // 预览使用完整媒体列表，先扩充虚拟列表范围，再在下一轮 effect 中定位。
      setIsExpanded(true)
      return
    }

    const frame = requestAnimationFrame(() => {
      scrollToIndex(returnIndex, { align: 'start', behavior: 'auto' })
      setHighlightedIndex(returnIndex)
      onReturnHandled()
    })

    return () => cancelAnimationFrame(frame)
  }, [fullyVisible, visibleCount, onReturnHandled, returnIndex, scrollToIndex, setCurrentIndex])

  useEffect(() => {
    if (highlightedIndex === null) return

    const timeout = window.setTimeout(() => setHighlightedIndex(null), 1200)
    return () => window.clearTimeout(timeout)
  }, [highlightedIndex])

  useEffect(() => {
    const targetIndex = pendingScrollIndexRef.current
    if (!isExpanded || targetIndex === null) return

    const frame = requestAnimationFrame(() => {
      if (pendingScrollIndexRef.current !== targetIndex) return
      scrollToIndex(targetIndex, { align: 'start', behavior: 'auto' })
      pendingScrollIndexRef.current = null
    })

    return () => cancelAnimationFrame(frame)
  }, [isExpanded, scrollToIndex, visibleCount])

  const handleAnchorSelect = useCallback(
    (index: number) => {
      useArtworkAutoBrowseStore.getState().pause('manual')
      setCurrentIndex(index)
      setIsNavigationOpen(false)

      collapsePendingRef.current = false
      if (!fullyVisible && index >= visibleCount) {
        pendingScrollIndexRef.current = index
        setIsExpanded(true)
        return
      }

      scrollToIndex(index, { align: 'start', behavior: 'auto' })
    },
    [fullyVisible, visibleCount, scrollToIndex, setCurrentIndex]
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
          const decoration = summaryDecorations?.get(media.id)

          return (
            <div
              key={virtualItem.key}
              ref={measureElement}
              data-index={index}
              data-summary-anchor={media.id}
              className="absolute left-0 right-0 top-0"
              style={{
                transform: `translateY(${virtualItem.start - scrollMargin}px)`
              }}
            >
              {decoration && decoration.group.mediaIds.length > 1 ? (
                <ArtworkStackCard
                  key={`${decoration.group.id}:${retryCounts[media.id] ?? 0}`}
                  media={media}
                  index={index}
                  decoration={decoration}
                  height={stackHeight}
                  reading={reading}
                  trackingActive={trackingActive}
                  onMenu={onOpenPreviewMenu}
                  onPreview={onOpenAdaptivePreview}
                />
              ) : (
                <ArtworkMediaItem
                  key={`${media.id}:${media.path}:${media.updatedAt}:${retryCounts[media.id] ?? 0}`}
                  media={media}
                  index={index}
                  autoMode={driverMode}
                  onOpenPreviewMenu={onOpenPreviewMenu}
                  onOpenAdaptivePreview={onOpenAdaptivePreview}
                  highlighted={highlightedIndex === index}
                  reading={reading}
                  trackingActive={trackingActive}
                />
              )}
            </div>
          )
        })}
      </div>

      {collapsible && (
        <div ref={collapsedFooterRef} className="scroll-mb-[calc(var(--app-mobile-navigation-offset)+1rem)]">
          {isExpanded ? (
            <div className="flex justify-center py-3">
              <Button variant="secondary" className="h-12 rounded-full px-8" onClick={toggleExpanded}>
                收起媒体列表
              </Button>
            </div>
          ) : (
            <ExpandRemainingMediaButton remainingCount={remainingCount} onExpand={expand} />
          )}
        </div>
      )}

      <ArtworkFloatingPortal active={showAutoControls || (!previewOpen && mediaIndexReady)}>
        {showAutoControls ? (
          <div
            data-auto-scroll-bar
            className={
              detailControls
                ? ''
                : 'fixed bottom-[calc(var(--app-mobile-navigation-offset)+0.75rem)] right-4 z-40 lg:bottom-4'
            }
          >
            <AutoBrowseControls
              mode={driverMode}
              current={(originalIndexes[currentIndex] ?? currentIndex) + 1}
              total={originalTotal}
              navigation={
                images.length > 1 || detailControls ? (
                  <MediaAnchorNavigation
                    onRate={detailControls?.openRating}
                    ratingLevel={detailControls?.ratingLevel}
                    portaled={Boolean(detailControls)}
                    originalIndexes={originalIndexes}
                    originalTotal={originalTotal}
                    collapsible={collapsible}
                    expanded={isExpanded}
                    onToggleExpanded={toggleExpanded}
                    onBackToTop={backToTop}
                    embedded
                    indexes={anchorIndexes}
                    activeIndex={activeAnchorIndex}
                    currentIndex={currentIndex}
                    total={images.length}
                    open={isNavigationOpen}
                    onOpenChange={(open) => {
                      if (open) useArtworkAutoBrowseStore.getState().pause('overlay')
                      setIsNavigationOpen(open)
                    }}
                    onSelect={handleAnchorSelect}
                  />
                ) : undefined
              }
              onRestart={() => {
                if (summaryMode && allImages[0]) {
                  summary?.reveal(allImages[0].id)
                  useArtworkAutoBrowseStore.getState().setCurrentMedia(allImages[0].id)
                }
                const { top } = getAutoBrowseViewport()
                if (containerRef.current) {
                  window.scrollTo({
                    top: Math.max(0, containerRef.current.getBoundingClientRect().top + window.scrollY - top),
                    behavior: 'instant'
                  })
                }
                useArtworkAutoBrowseStore.getState().start(driverMode)
              }}
              onRetry={() => {
                const state = useArtworkAutoBrowseStore.getState()
                state.pause()
                const id = state.currentMediaId
                if (id !== null) setRetryCounts((counts) => ({ ...counts, [id]: (counts[id] ?? 0) + 1 }))
                reader?.store?.retry()
                state.clearPauseReason()
              }}
              onSkip={() => {
                const state = useArtworkAutoBrowseStore.getState()
                state.pause()
                const index = images.findIndex((media) => media.id === state.currentMediaId)
                if (index < 0) return
                state.skip(images[index]!.id)
              }}
              onExit={() => useArtworkAutoBrowseStore.getState().stop()}
            />
          </div>
        ) : (
          !previewOpen &&
          mediaIndexReady && (
            <MediaAnchorNavigation
              onRate={detailControls?.openRating}
              ratingLevel={detailControls?.ratingLevel}
              portaled={Boolean(detailControls)}
              originalIndexes={originalIndexes}
              originalTotal={originalTotal}
              collapsible={collapsible}
              expanded={isExpanded}
              onToggleExpanded={toggleExpanded}
              onBackToTop={backToTop}
              indexes={anchorIndexes}
              activeIndex={activeAnchorIndex}
              currentIndex={currentIndex}
              total={images.length}
              open={isNavigationOpen}
              onOpenChange={(open) => {
                if (open) useArtworkAutoBrowseStore.getState().pause('overlay')
                setIsNavigationOpen(open)
              }}
              onSelect={handleAnchorSelect}
            />
          )
        )}
      </ArtworkFloatingPortal>
    </>
  )
}

function ArtworkImagesSession({
  images,
  allImages = images,
  artworkId,
  reading,
  trackingActive = true,
  continueRequest,
  summaryMode,
  summaryDecorations,
  onContinueHandled
}: ArtworkImagesProps) {
  useAutoBrowseInterruption(artworkId)
  const summary = useArtworkSummary()
  const mediaRootRef = useRef<HTMLDivElement>(null)
  useArtworkVideoPlayback(mediaRootRef)
  const [previewState, setPreviewState] = useState<AdaptivePreviewState | null>(null)
  const [returnIndex, setReturnIndex] = useState<number | null>(null)
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const adaptivePreviewImages = useMemo(() => allImages.filter((media) => !isVideoMedia(media)), [allImages])
  const continueHandledRef = useRef(onContinueHandled)
  continueHandledRef.current = onContinueHandled
  useEffect(() => {
    if (!continueRequest) return
    // Human navigation pauses at its entry point; automatic stack transitions also use this path.
    if (images.length === 1) {
      mediaRootRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
      continueHandledRef.current?.()
      return
    }
    setReturnIndex(Math.min(Math.max(continueRequest.index, 0), images.length - 1))
  }, [continueRequest, images.length])
  const openAdaptivePreview = useCallback(
    (originalIndex: number, initialPreviewSrc?: string) => {
      const media = images[originalIndex]
      if (!media || isVideoMedia(media)) return
      const filteredIndex = adaptivePreviewImages.findIndex((candidate) => candidate.id === media.id)
      if (filteredIndex >= 0) {
        useArtworkAutoBrowseStore.getState().pause('overlay')
        useArtworkAutoBrowseStore.getState().setPreviewOpen(true)
        useArtworkAutoBrowseStore.getState().setCurrentMedia(media.id)
        setPreviewState({ index: filteredIndex, ...(initialPreviewSrc ? { initialPreviewSrc } : {}) })
      }
    },
    [adaptivePreviewImages, images]
  )
  const { contextMenu, openContextMenu, closeContextMenu, previewSelectedMedia, viewOriginalSelectedMedia } =
    usePreviewContextMenu(images, allImages, artworkId, openAdaptivePreview, reading)

  const handlePreviewClose = useCallback(
    (finalIndex: number) => {
      const state = useArtworkAutoBrowseStore.getState()
      state.closePreview()
      const returnedMedia = adaptivePreviewImages[finalIndex]
      const originalIndex = returnedMedia ? images.findIndex((media) => media.id === returnedMedia.id) : -1
      if (summaryMode && returnedMedia) {
        summary?.reveal(returnedMedia.id)
        setPreviewState(null)
        return
      }
      setPreviewState(null)
      if (originalIndex < 0) return
      setCurrentIndex(originalIndex)
      useArtworkAutoBrowseStore.getState().setCurrentMedia(returnedMedia!.id)
      setReturnIndex(originalIndex)
    },
    [adaptivePreviewImages, images, setCurrentIndex, summaryMode, summary?.reveal]
  )

  const handleReturnHandled = useCallback(() => {
    setReturnIndex(null)
    continueHandledRef.current?.()
  }, [])

  useReaderMediaWindow('single-video', images.length === 1 ? [images[0]!.id] : [])
  const mediaContent =
    images.length === 1 && images[0]?.detailsPending ? (
      <MediaDetailsPlaceholder media={images[0]} index={0} />
    ) : isSingleVideoArtwork(images) ? (
      <SingleVideoArtworkMedia
        media={images[0]!}
        onOpenMenu={openContextMenu}
        reading={reading}
        trackingActive={trackingActive && !previewState && !contextMenu}
      />
    ) : (
      <VirtualizedArtworkMediaList
        summaryMode={summaryMode}
        summaryDecorations={summaryDecorations}
        images={images}
        allImages={allImages}
        returnIndex={returnIndex}
        onReturnHandled={handleReturnHandled}
        onOpenPreviewMenu={openContextMenu}
        onOpenAdaptivePreview={openAdaptivePreview}
        reading={reading}
        trackingActive={trackingActive && !previewState && !contextMenu}
      />
    )

  const videoImageIds = useMemo(
    () => images.filter((media) => !media.detailsPending && isVideoMedia(media)).map((media) => media.id),
    [images]
  )

  return (
    <ArtworkVideoOptimizationProvider imageIds={videoImageIds}>
      <div ref={mediaRootRef}>{mediaContent}</div>
      <PreviewContextMenu
        stackMode={summaryMode}
        contextMenu={contextMenu}
        reading={reading}
        images={images}
        onOpenChange={(open) => {
          if (!open) closeContextMenu()
        }}
        onPreview={previewSelectedMedia}
        onAutoScroll={() => {
          const selected = contextMenu ? images[contextMenu.index] : undefined
          if (summaryMode && selected) {
            summary?.reveal(selected.id)
            useArtworkAutoBrowseStore.getState().setCurrentMedia(selected.id)
          }
          closeContextMenu()
          useArtworkAutoBrowseStore.getState().start(summaryMode ? 'slideshow' : 'scroll')
        }}
        onViewOriginal={viewOriginalSelectedMedia}
      />
      {previewState !== null && (
        <AdaptiveMediaPreview
          images={adaptivePreviewImages}
          initialIndex={previewState.index}
          initialPreviewSrc={previewState.initialPreviewSrc}
          open
          onClose={handlePreviewClose}
          reading={reading}
        />
      )}
    </ArtworkVideoOptimizationProvider>
  )
}

export default function ArtworkImages(props: ArtworkImagesProps) {
  const ready = useArtworkDetailPreferencesReady()
  if (!ready) return <div className="min-h-72" aria-busy="true" aria-label="正在恢复浏览偏好" />
  return <ArtworkImagesSession key={props.artworkId} {...props} />
}
