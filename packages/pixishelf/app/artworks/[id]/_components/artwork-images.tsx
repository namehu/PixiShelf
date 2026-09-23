'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { ArrowUpToLine, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  getArtworkDisplayPolicy,
  useArtworkDetailPreferences,
  useArtworkDetailPreferencesReady
} from '@/store/use-artwork-detail-preferences'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import LazyMedia from './lazy-media'
import { useLongPress } from '@/hooks/use-long-press'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useRouter } from 'next/navigation'
import { useArtworkStore } from '@/store/use-artwork-store'
import { useArtworkMediaAnchorInterval } from '@/components/user-setting'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { isApngFile, isGifFile, isVideoFile, isWebpFile } from '@/lib/media'
import { hasReliableSingleFrameDimensions } from '@/lib/media-animation'
import { cn } from '@/lib/utils'
import AdaptiveMediaPreview from './adaptive-media-preview'
import { ArtworkVideoOptimizationProvider } from './artwork-video-optimization-context'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { useAutoBrowseInterruption } from './use-auto-browse-interruption'
import { getAutoBrowseViewport, useArtworkAutoScroll } from './use-artwork-auto-scroll'
import { AutoBrowseControls } from './auto-browse-controls'
import { useArtworkVideoPlayback } from './use-artwork-video-playback'

interface ArtworkImagesProps {
  images: ArtworkImageResponseDto[]
  artworkId: number
}

const NAV_HEIGHT = 64

type PreviewMenuState = { x: number; y: number; index: number }
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
  if (hasReliableSingleFrameDimensions(media) && media.width && media.height && media.width > 0 && media.height > 0) {
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

function useMeasuredMediaContainer() {
  const [containerWidth, setContainerWidth] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [scrollPaddingStart, setScrollPaddingStart] = useState(NAV_HEIGHT)
  const containerRef = useRef<HTMLDivElement>(null)

  const updateMeasurements = useCallback(() => {
    if (!containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const nextWidth = Math.max(1, rect.width)
    const nextScrollMargin = rect.top + window.scrollY

    setContainerWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth))
    setScrollMargin((currentMargin) => (currentMargin === nextScrollMargin ? currentMargin : nextScrollMargin))
    setScrollPaddingStart(getAutoBrowseViewport().top)
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

  return { containerRef, containerWidth, scrollMargin, scrollPaddingStart }
}

function useArtworkMediaVirtualizer({
  images,
  visibleCount,
  containerWidth,
  scrollMargin,
  scrollPaddingStart
}: {
  images: ArtworkImageResponseDto[]
  visibleCount: number
  containerWidth: number
  scrollMargin: number
  scrollPaddingStart: number
}) {
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

function usePreviewContextMenu(images: ArtworkImageResponseDto[], onOpenAdaptivePreview: (index: number) => void) {
  const [contextMenu, setContextMenu] = useState<PreviewMenuState | null>(null)
  const router = useRouter()
  const setStoreImages = useArtworkStore((state) => state.setImages)

  const openContextMenu = useCallback((event: React.MouseEvent | React.TouchEvent, index: number) => {
    const position = getPointerPosition(event)
    if (!position) return
    useArtworkAutoBrowseStore.getState().pause('overlay')

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
      className="select-none [&_img]:pointer-events-none [&_img]:[-webkit-touch-callout:none]"
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
    >
      {children}
    </div>
  )
}

function ArtworkMediaItem({
  media,
  index,
  onOpenPreviewMenu,
  onOpenAdaptivePreview,
  highlighted
}: {
  media: ArtworkImageResponseDto
  index: number
  onOpenPreviewMenu: (e: React.MouseEvent | React.TouchEvent, index: number) => void
  onOpenAdaptivePreview: (index: number, initialPreviewSrc?: string) => void
  highlighted: boolean
}) {
  return (
    <div
      className={cn(
        'group relative transition-[box-shadow] duration-(--motion-base)',
        highlighted && 'z-[1] ring-4 ring-ring/70 ring-offset-2 ring-offset-background'
      )}
      data-preview-highlighted={highlighted ? 'true' : undefined}
    >
      <PreviewableMedia
        index={index}
        enabled={!isVideoMedia(media)}
        tapPreviewEnabled={canPreviewFullSize(media) && !keepsSurfacePlaybackControl(media)}
        onOpenMenu={onOpenPreviewMenu}
        onPreview={onOpenAdaptivePreview}
      >
        <LazyMedia media={media} index={index} />
      </PreviewableMedia>
    </div>
  )
}

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

function MediaAnchorList({
  indexes,
  activeIndex,
  onSelect
}: {
  indexes: number[]
  activeIndex: number
  onSelect: (index: number) => void
}) {
  const activeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeButtonRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  return (
    <nav aria-label="作品媒体快捷导航">
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
                'font-utility flex size-9 items-center justify-center rounded-full px-1 text-center text-xs tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary-foreground/50',
                isActive
                  ? 'bg-primary-foreground font-semibold text-primary'
                  : 'text-primary-foreground/75 hover:bg-primary-foreground/15 hover:text-primary-foreground'
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
  currentIndex,
  total,
  open,
  onOpenChange,
  onSelect,
  collapsible,
  expanded,
  onToggleExpanded,
  onBackToTop,
  embedded = false
}: {
  indexes: number[]
  activeIndex: number
  currentIndex: number
  total: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (index: number) => void
  collapsible: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onBackToTop: () => void
  embedded?: boolean
}) {
  const dockRef = useRef<HTMLDivElement>(null)
  if (total <= 1) return null

  const displayedIndex = Math.min(Math.max(currentIndex, 0), total - 1) + 1
  const counter = (
    <span className="font-utility flex flex-col items-center justify-center gap-0.5 text-[10px] leading-none tabular-nums">
      <span className="font-semibold">{displayedIndex}</span>
      <Separator className={cn('w-3', embedded ? 'bg-foreground/25' : 'bg-primary-foreground/35')} />
      <span className="font-normal opacity-70">{total}</span>
    </span>
  )

  return (
    <div className={embedded ? '' : 'fixed right-4 bottom-[calc(var(--app-mobile-navigation-offset)+1rem)] z-40'}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={embedded ? 'ghost' : 'default'}
            size="icon"
            className={cn('size-11 rounded-full', !embedded && 'shadow-floating')}
            aria-label={`${open ? '关闭' : '打开'}媒体快捷导航，当前第 ${displayedIndex} 张，共 ${total} 张`}
            aria-expanded={open}
          >
            {counter}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          ref={dockRef}
          tabIndex={-1}
          side="top"
          align="end"
          sideOffset={-44}
          avoidCollisions={false}
          onOpenAutoFocus={(event) => {
            // 聚焦容器而非首个功能按钮，避免刚展开就触发按钮的焦点 tooltip。
            event.preventDefault()
            dockRef.current?.focus({ preventScroll: true })
          }}
          aria-label="作品浏览控制"
          className="pointer-events-none relative flex min-h-24 w-[116px] origin-bottom-right justify-end border-0 bg-transparent p-0 pb-[52px] shadow-none motion-reduce:animate-none"
        >
          {/* 弹层底边与 44px 主按钮底边重合；预留 52px，让页码与主按钮保持 8px 间隔。 */}
          <div className="pointer-events-auto absolute bottom-0 right-[72px]">
            <Tooltip delayDuration={350}>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  className="size-11 rounded-full shadow-floating"
                  aria-label="回到顶部"
                  onClick={() => {
                    onOpenChange(false)
                    onBackToTop()
                  }}
                >
                  <ArrowUpToLine className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">回到顶部</TooltipContent>
            </Tooltip>
          </div>
          {collapsible && (
            <div className="pointer-events-auto absolute bottom-[52px] right-[52px]">
              <Tooltip delayDuration={350}>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    className="size-11 rounded-full shadow-floating"
                    aria-label={expanded ? '收起媒体列表' : '展开全部媒体'}
                    onClick={() => {
                      onOpenChange(false)
                      onToggleExpanded()
                    }}
                  >
                    {expanded ? <ChevronsDownUp className="size-4" /> : <ChevronsUpDown className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{expanded ? '收起媒体列表' : '展开全部媒体'}</TooltipContent>
              </Tooltip>
            </div>
          )}
          {indexes.length > 0 ? (
            <div
              data-testid="media-anchor-popover"
              className="pointer-events-auto max-h-[min(70dvh,calc(var(--radix-popover-content-available-height)-52px))] w-11 overflow-y-auto overscroll-contain rounded-full border border-primary/20 bg-primary p-1 text-primary-foreground shadow-floating"
            >
              <MediaAnchorList indexes={indexes} activeIndex={activeIndex} onSelect={onSelect} />
            </div>
          ) : (
            <div className="h-11" />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function PreviewContextMenu({
  contextMenu,
  images,
  onOpenChange,
  onPreview,
  onAutoScroll,
  onViewOriginal
}: {
  contextMenu: PreviewMenuState | null
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
        {selectedMedia && !isVideoMedia(selectedMedia) && (
          <Button variant="ghost" className="min-h-11 w-full justify-start" onClick={onAutoScroll}>
            自动滚动
          </Button>
        )}
        <button
          type="button"
          onClick={onPreview}
          className="block min-h-10 w-full cursor-pointer select-none rounded-sm px-4 py-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
        >
          适配尺寸预览
        </button>
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

function SingleVideoArtworkMedia({ media }: { media: ArtworkImageResponseDto }) {
  return (
    <div className="w-full" data-testid="artwork-video-container">
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
  onOpenAdaptivePreview: (index: number, initialPreviewSrc?: string) => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const previewCount = useArtworkDetailPreferences((state) => state.previewCount)
  const { collapsible, visibleCount, remainingCount, fullyVisible } = getArtworkDisplayPolicy(
    images.length,
    previewCount,
    isExpanded
  )
  const collapsePendingRef = useRef(false)
  const collapsedFooterRef = useRef<HTMLDivElement>(null)
  const [isNavigationOpen, setIsNavigationOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null)
  const [retryCounts, setRetryCounts] = useState<Record<number, number>>({})
  const autoMode = useArtworkAutoBrowseStore((state) => state.mode)
  const previewOpen = useArtworkAutoBrowseStore((state) => state.previewOpen)
  const showAutoControls = autoMode === 'scroll' && !previewOpen
  const pendingScrollIndexRef = useRef<number | null>(null)
  const anchorInterval = useArtworkMediaAnchorInterval()
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const currentIndex = useArtworkStore((state) => state.currentIndex)
  const { containerRef, containerWidth, scrollMargin, scrollPaddingStart } = useMeasuredMediaContainer()
  const { virtualizer, measureElement } = useArtworkMediaVirtualizer({
    images,
    visibleCount,
    containerWidth,
    scrollMargin,
    scrollPaddingStart
  })
  const expand = useCallback(() => setIsExpanded(true), [])
  // 自动滚动只关心是否能浏览完整作品，自然全显不需要再触发主动展开。
  useArtworkAutoScroll({ containerRef, images, expanded: fullyVisible, expand })

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

          return (
            <div
              key={virtualItem.key}
              ref={measureElement}
              data-index={index}
              className="absolute left-0 right-0 top-0"
              style={{
                transform: `translateY(${virtualItem.start - scrollMargin}px)`
              }}
            >
              <ArtworkMediaItem
                key={`${media.id}:${media.path}:${media.updatedAt}:${retryCounts[media.id] ?? 0}`}
                media={media}
                index={index}
                onOpenPreviewMenu={onOpenPreviewMenu}
                onOpenAdaptivePreview={onOpenAdaptivePreview}
                highlighted={highlightedIndex === index}
              />
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

      {showAutoControls ? (
        <div
          data-auto-scroll-bar
          className="fixed bottom-[calc(var(--app-mobile-navigation-offset)+0.75rem)] right-4 z-40 lg:bottom-4"
        >
          <AutoBrowseControls
            mode="scroll"
            current={currentIndex + 1}
            total={images.length}
            navigation={
              images.length > 1 ? (
                <MediaAnchorNavigation
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
              const { top } = getAutoBrowseViewport()
              if (containerRef.current) {
                window.scrollTo({
                  top: Math.max(0, containerRef.current.getBoundingClientRect().top + window.scrollY - top),
                  behavior: 'instant'
                })
              }
              useArtworkAutoBrowseStore.getState().start('scroll')
            }}
            onRetry={() => {
              const state = useArtworkAutoBrowseStore.getState()
              state.pause()
              const id = state.currentMediaId
              if (id !== null) setRetryCounts((counts) => ({ ...counts, [id]: (counts[id] ?? 0) + 1 }))
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
        !previewOpen && (
          <MediaAnchorNavigation
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
    </>
  )
}

function ArtworkImagesSession({ images, artworkId }: ArtworkImagesProps) {
  useAutoBrowseInterruption(artworkId)
  const mediaRootRef = useRef<HTMLDivElement>(null)
  useArtworkVideoPlayback(mediaRootRef)
  const [previewState, setPreviewState] = useState<AdaptivePreviewState | null>(null)
  const [returnIndex, setReturnIndex] = useState<number | null>(null)
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const adaptivePreviewImages = useMemo(() => images.filter((media) => !isVideoMedia(media)), [images])
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
    usePreviewContextMenu(images, openAdaptivePreview)

  const handlePreviewClose = useCallback(
    (finalIndex: number) => {
      const state = useArtworkAutoBrowseStore.getState()
      state.closePreview()
      const returnedMedia = adaptivePreviewImages[finalIndex]
      const originalIndex = returnedMedia ? images.findIndex((media) => media.id === returnedMedia.id) : -1
      setPreviewState(null)
      if (originalIndex < 0) return
      setCurrentIndex(originalIndex)
      useArtworkAutoBrowseStore.getState().setCurrentMedia(returnedMedia!.id)
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
      <div ref={mediaRootRef}>{mediaContent}</div>
      <PreviewContextMenu
        contextMenu={contextMenu}
        images={images}
        onOpenChange={(open) => {
          if (!open) closeContextMenu()
        }}
        onPreview={previewSelectedMedia}
        onAutoScroll={() => {
          closeContextMenu()
          useArtworkAutoBrowseStore.getState().start('scroll')
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
