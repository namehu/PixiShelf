'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso'
import { RefreshCwIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

export interface ArchiveDiscoveryListPosition {
  anchorId: string | null
  anchorOffset: number
  scrollTop: number
  windowScrollY: number
}

interface ArchiveDiscoveryResultListProps<TItem extends { id: string }> {
  items: TItem[]
  isDesktop: boolean
  layoutReady: boolean
  isLoading: boolean
  isError: boolean
  errorTitle: string
  errorDescription: string
  emptyState: ReactNode
  header: ReactNode
  renderItem: (item: TItem) => ReactNode
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
  onRetry: () => void
  positionKey: string
  position?: ArchiveDiscoveryListPosition
  onPositionChange: (position: ArchiveDiscoveryListPosition) => void
}

export function ArchiveDiscoveryResultList<TItem extends { id: string }>({
  items,
  isDesktop,
  layoutReady,
  isLoading,
  isError,
  errorTitle,
  errorDescription,
  emptyState,
  header,
  renderItem,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onRetry,
  positionKey,
  position,
  onPositionChange
}: ArchiveDiscoveryResultListProps<TItem>) {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement | Window | null>(null)
  const lastVisibleItemRef = useRef<{ id: string; offset: number } | null>(null)
  const visibleRangeRef = useRef<ListRange | null>(null)
  const lastRequestedLengthRef = useRef<number | null>(null)
  const restoredLayoutRef = useRef<string | null>(null)
  const restoringRef = useRef(true)
  const captureRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (lastRequestedLengthRef.current !== null && lastRequestedLengthRef.current !== items.length) {
      lastRequestedLengthRef.current = null
    }
    if (isError) lastRequestedLengthRef.current = null
  }, [items.length, isError])

  const capturePosition = useCallback(() => {
    if (restoringRef.current || !rootRef.current?.isConnected) return
    const range = visibleRangeRef.current
    const viewportTop =
      isDesktop && scrollerRef.current instanceof HTMLElement ? scrollerRef.current.getBoundingClientRect().top : 0
    const viewportBottom =
      isDesktop && scrollerRef.current instanceof HTMLElement
        ? scrollerRef.current.getBoundingClientRect().bottom
        : window.innerHeight
    if (range && rootRef.current) {
      let foundVisibleItem = false
      for (let index = range.startIndex; index <= range.endIndex; index += 1) {
        const element = rootRef.current.querySelector<HTMLElement>(`[data-item-index="${index}"]`)
        const item = items[index]
        if (!element || !item) continue
        const rect = element.getBoundingClientRect()
        if (rect.bottom <= viewportTop || rect.top >= viewportBottom) continue
        lastVisibleItemRef.current = { id: item.id, offset: rect.top - viewportTop }
        foundVisibleItem = true
        break
      }
      if (!foundVisibleItem) lastVisibleItemRef.current = null
    }
    const current = lastVisibleItemRef.current
    const scrollTop =
      scrollerRef.current === window
        ? window.scrollY
        : scrollerRef.current instanceof HTMLElement
          ? scrollerRef.current.scrollTop
          : 0
    onPositionChange({
      anchorId: current?.id ?? null,
      anchorOffset: current?.offset ?? 0,
      scrollTop,
      windowScrollY: window.scrollY
    })
  }, [isDesktop, items, onPositionChange])

  useLayoutEffect(() => {
    captureRef.current = capturePosition
  }, [capturePosition])

  // Capture before React removes the old scroll host, while its row geometry is valid.
  useLayoutEffect(() => () => captureRef.current(), [positionKey, isDesktop])

  useEffect(() => {
    if (isDesktop) return
    const capture = () => captureRef.current()
    window.addEventListener('scroll', capture, { passive: true })
    return () => window.removeEventListener('scroll', capture)
  }, [isDesktop])

  useEffect(() => {
    if (!layoutReady || isLoading || items.length === 0) return
    const restoreKey = `${positionKey}:${isDesktop ? 'desktop' : 'window'}`
    if (restoredLayoutRef.current === restoreKey) return
    restoringRef.current = true
    let frame = 0
    let attempts = 0
    const savedPosition = position
    const anchorIndex = savedPosition?.anchorId ? items.findIndex(({ id }) => id === savedPosition.anchorId) : -1
    const restore = () => {
      if (!virtuosoRef.current) {
        if (++attempts < 30) frame = window.requestAnimationFrame(restore)
        else restoringRef.current = false
        return
      }
      if (anchorIndex >= 0) {
        virtuosoRef.current.scrollToIndex({
          index: anchorIndex,
          align: 'start',
          offset: -(savedPosition?.anchorOffset ?? 0)
        })
      } else if (!isDesktop && savedPosition) {
        window.scrollTo({ top: savedPosition.windowScrollY })
      } else if (isDesktop && savedPosition) {
        virtuosoRef.current.scrollTo({ top: savedPosition.scrollTop })
      }
      const settle = () => {
        const anchor =
          anchorIndex >= 0 ? rootRef.current?.querySelector<HTMLElement>(`[data-item-index="${anchorIndex}"]`) : null
        if (anchor) {
          const viewportTop =
            isDesktop && scrollerRef.current instanceof HTMLElement
              ? scrollerRef.current.getBoundingClientRect().top
              : 0
          const delta = anchor.getBoundingClientRect().top - viewportTop - (savedPosition?.anchorOffset ?? 0)
          if (Math.abs(delta) > 1) {
            if (isDesktop && scrollerRef.current instanceof HTMLElement) scrollerRef.current.scrollTop += delta
            else window.scrollBy({ top: delta })
          }
        }
        // Window scrolling needs a few frames for Virtuoso to measure the target rows.
        if (++attempts < 8) frame = window.requestAnimationFrame(settle)
        else {
          restoredLayoutRef.current = restoreKey
          restoringRef.current = false
        }
      }
      frame = window.requestAnimationFrame(settle)
    }
    frame = window.requestAnimationFrame(restore)
    return () => window.cancelAnimationFrame(frame)
  }, [isDesktop, isLoading, items, layoutReady, position, positionKey])

  if (!layoutReady || isLoading) return <Skeleton className="h-[60vh] min-h-80 w-full" />
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{errorTitle}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{errorDescription}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
            重新加载
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (items.length === 0) return emptyState

  return (
    <Card ref={rootRef} className="@container/discovery-results gap-0 overflow-hidden py-0">
      {header}
      <Virtuoso
        key={isDesktop ? 'desktop' : 'window'}
        ref={virtuosoRef}
        data={items}
        computeItemKey={(_index, item) => item.id}
        useWindowScroll={!isDesktop}
        className={isDesktop ? 'h-[60vh] min-h-80 max-h-[44rem]' : undefined}
        overscan={600}
        scrollerRef={(element) => {
          scrollerRef.current = element
        }}
        rangeChanged={(range) => {
          visibleRangeRef.current = range
          window.requestAnimationFrame(capturePosition)
        }}
        isScrolling={(scrolling) => {
          if (!scrolling) capturePosition()
        }}
        endReached={() => {
          if (!hasNextPage || isFetchingNextPage || lastRequestedLengthRef.current === items.length) return
          lastRequestedLengthRef.current = items.length
          onLoadMore()
        }}
        itemContent={(_index, item) => renderItem(item)}
        components={{
          Footer: () =>
            isFetchingNextPage ? (
              <div className="flex min-h-20 items-center justify-center gap-2 border-t text-sm text-muted-foreground">
                <Spinner aria-hidden="true" />
                正在加载更多结果…
              </div>
            ) : null
        }}
      />
      <div className="flex min-h-11 items-center justify-between gap-3 border-t px-4 text-xs text-muted-foreground">
        <span>已加载 {items.length} 条 · 单次最多选择 100 条</span>
        {isFetchingNextPage ? (
          <span className="flex items-center gap-2">
            <Spinner aria-hidden="true" />
            加载中
          </span>
        ) : hasNextPage ? (
          <span>继续向下滚动</span>
        ) : (
          <span>已加载全部</span>
        )}
      </div>
    </Card>
  )
}
