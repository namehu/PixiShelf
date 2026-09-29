'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ExternalLinkIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { useTRPC } from '@/lib/trpc'
import type {
  ArchivePreviewPageDto,
  ArchivePreviewThumbnailDto
} from '@/services/archive-preview/archive-preview-types'
import { ControlledAutoBrowseControls } from './controlled-auto-browse-controls'
import { SourcePreviewThumbnail } from './source-preview-thumbnail'
import {
  VerticalMediaPreviewCore,
  type VerticalMediaPreviewController
} from './vertical-media-preview-core'
import { useSourcePreviewAutoBrowse } from './use-source-preview-auto-browse'

export type ArchivePreviewPage = ArchivePreviewPageDto

interface SourcePreviewReaderProps {
  previewId: string
  initialPage?: ArchivePreviewPage
}

const SOURCE_PREVIEW_HISTORY_KEY = '__pixishelf_source_preview__'

function mergePages(pages: Map<number, ArchivePreviewPage>): ArchivePreviewThumbnailDto[] {
  const byOrdinal = new Map<number, ArchivePreviewThumbnailDto>()
  for (const page of [...pages.values()].sort((left, right) => left.page - right.page)) {
    for (const item of page.items) byOrdinal.set(item.ordinal, item)
  }
  return [...byOrdinal.values()].sort((left, right) => left.ordinal - right.ordinal)
}

function errorLabel(error: unknown) {
  const code = (error as { data?: { code?: string } } | null)?.data?.code
  return code === 'TOO_MANY_REQUESTS' ? '来源暂时繁忙，请稍后重试。' : '缩略图读取失败，请重试。'
}

export function updateSourcePreviewVisibility(
  ratios: Map<number, number>,
  updates: Array<{ ordinal: number; ratio: number; visible: boolean }>
) {
  for (const update of updates) {
    if (update.visible && update.ratio > 0) ratios.set(update.ordinal, update.ratio)
    else ratios.delete(update.ordinal)
  }
  let best: { ordinal: number; ratio: number } | null = null
  for (const [ordinal, ratio] of ratios) {
    if (!best || ratio > best.ratio || (ratio === best.ratio && ordinal > best.ordinal)) best = { ordinal, ratio }
  }
  return best?.ordinal ?? null
}

export function SourcePreviewReader({ previewId, initialPage }: SourcePreviewReaderProps) {
  const trpc = useTRPC()
  const pageMutation = useMutation(trpc.archivePreview.page.mutationOptions())
  const reloadMutation = useMutation(trpc.archivePreview.reload.mutationOptions())
  const auto = useSourcePreviewAutoBrowse(previewId)
  const [pages, setPages] = useState<Map<number, ArchivePreviewPage>>(
    () => new Map(initialPage ? [[initialPage.page, initialPage]] : [])
  )
  const [loadingPage, setLoadingPage] = useState<number | null>(initialPage ? null : 0)
  const [failedPage, setFailedPage] = useState<number | null>(null)
  const [reloadFailed, setReloadFailed] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [zoomScale, setZoomScale] = useState(1)
  const [transitioning, setTransitioning] = useState(false)
  const [loadedOrdinals, setLoadedOrdinals] = useState<Set<number>>(() => new Set())
  const [failedOrdinals, setFailedOrdinals] = useState<Set<number>>(() => new Set())
  const [retryCounts, setRetryCounts] = useState<Record<number, number>>({})
  const controllerRef = useRef<VerticalMediaPreviewController | null>(null)
  const listNodesRef = useRef(new Map<number, HTMLButtonElement>())
  const visibilityRatiosRef = useRef(new Map<number, number>())
  const sentinelRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef<{
    previewId: string
    page: number
    generation: number
    promise: Promise<ArchivePreviewPage | null>
  } | null>(null)
  const generationRef = useRef(0)
  const mountedRef = useRef(false)
  const initializedPreviewRef = useRef<string | null>(null)
  const latestInitialPageRef = useRef(initialPage)
  latestInitialPageRef.current = initialPage

  const items = useMemo(() => mergePages(pages), [pages])
  const orderedPages = useMemo(() => [...pages.values()].sort((left, right) => left.page - right.page), [pages])
  const firstPage = orderedPages[0] ?? null
  const lastPage = orderedPages.at(-1) ?? null
  const total = firstPage?.total ?? lastPage?.total ?? null
  const nextPage = lastPage?.nextPage ?? null
  const title = firstPage?.title ?? '来源预览'
  const activeItem = items[activeIndex]
  const activeReady = activeItem ? loadedOrdinals.has(activeItem.ordinal) : false
  const activeFailed = activeItem ? failedOrdinals.has(activeItem.ordinal) : false
  const failedThumbnail = items.find((item) => failedOrdinals.has(item.ordinal)) ?? null

  const markThumbnailFailed = useCallback(
    (ordinal: number) => {
      setFailedOrdinals((current) => new Set(current).add(ordinal))
      auto.error()
    },
    [auto.error]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
    const frame = requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }))
    return () => cancelAnimationFrame(frame)
  }, [previewId])

  const loadPage = useCallback(
    async (page: number, continueAfterLoad = false) => {
      const generation = generationRef.current
      if (
        requestRef.current?.previewId === previewId &&
        requestRef.current.page === page &&
        requestRef.current.generation === generation
      ) {
        return requestRef.current.promise
      }
      setLoadingPage(page)
      if (continueAfterLoad) auto.wait()
      const promise: Promise<ArchivePreviewPage | null> = pageMutation.mutateAsync({ previewId, page })
      requestRef.current = { previewId, page, generation, promise }
      try {
        const loaded = await promise
        if (!loaded || !mountedRef.current || generationRef.current !== generation) return null
        setPages((current) => new Map(current).set(loaded.page, loaded))
        setFailedPage(null)
        setPageError(null)
        if (continueAfterLoad) auto.ready()
        return loaded
      } catch (error) {
        if (!mountedRef.current || generationRef.current !== generation) return null
        setFailedPage(page)
        setPageError(errorLabel(error))
        if (continueAfterLoad) auto.error()
        throw error
      } finally {
        if (requestRef.current?.promise === promise) requestRef.current = null
        if (mountedRef.current && generationRef.current === generation) {
          setLoadingPage((current) => (current === page ? null : current))
        }
      }
    },
    [auto.error, auto.ready, auto.wait, pageMutation.mutateAsync, previewId]
  )

  useEffect(() => {
    if (initializedPreviewRef.current === previewId) return
    initializedPreviewRef.current = previewId
    generationRef.current += 1
    requestRef.current = null
    const first = latestInitialPageRef.current
    setPages(new Map(first ? [[first.page, first]] : []))
    setActiveIndex(0)
    setPreviewOpen(false)
    setLoadedOrdinals(new Set())
    setFailedOrdinals(new Set())
    setRetryCounts({})
    setFailedPage(null)
    setReloadFailed(false)
    setPageError(null)
    auto.reset()
    if (!first) void loadPage(0).catch(() => undefined)
  }, [auto.reset, loadPage, previewId])

  const loadNext = useCallback(
    (continueAfterLoad = false) => {
      if (nextPage === null || failedPage !== null || pageError !== null) {
        return Promise.resolve(null)
      }
      if (loadingPage !== null) {
        const pending = requestRef.current
        if (
          !continueAfterLoad ||
          !pending ||
          pending.previewId !== previewId ||
          pending.page !== nextPage ||
          pending.generation !== generationRef.current
        ) {
          return Promise.resolve(null)
        }
        auto.wait()
        return pending.promise.then(
          (page) => {
            if (page) auto.ready()
            return page
          },
          () => {
            auto.error()
            return null
          }
        )
      }
      return loadPage(nextPage, continueAfterLoad).catch(() => null)
    },
    [auto.error, auto.ready, auto.wait, failedPage, loadPage, loadingPage, nextPage, pageError, previewId]
  )

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !items.length) return
    const observer = new IntersectionObserver(
      (entries) => {
        const ordinal = updateSourcePreviewVisibility(
          visibilityRatiosRef.current,
          entries.map((entry) => ({
            ordinal: Number((entry.target as HTMLElement).dataset.sourcePreviewOrdinal),
            ratio: entry.intersectionRatio,
            visible: entry.isIntersecting
          }))
        )
        if (ordinal === null) return
        const index = items.findIndex((item) => item.ordinal === ordinal)
        if (index >= 0 && !previewOpen) setActiveIndex(index)
      },
      { threshold: [0.25, 0.5, 0.75] }
    )
    for (const node of listNodesRef.current.values()) observer.observe(node)
    return () => {
      observer.disconnect()
      visibilityRatiosRef.current.clear()
    }
  }, [items, previewOpen])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (
      !sentinel ||
      nextPage === null ||
      failedPage !== null ||
      pageError !== null ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadNext(auto.state.mode === 'scroll')
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [auto.state.mode, failedPage, loadNext, nextPage, pageError])

  useEffect(() => {
    if (
      !previewOpen ||
      nextPage === null ||
      failedPage !== null ||
      pageError !== null ||
      activeIndex < items.length - 2
    ) {
      return
    }
    void loadNext(auto.state.mode === 'slideshow' && ['running', 'waiting'].includes(auto.state.status))
  }, [
    activeIndex,
    auto.state.mode,
    auto.state.status,
    failedPage,
    items.length,
    loadNext,
    nextPage,
    pageError,
    previewOpen
  ])

  useEffect(() => {
    if (!previewOpen || auto.state.mode !== 'slideshow') return
    if (auto.state.status !== 'running' && auto.state.status !== 'waiting') return
    if (transitioning || zoomScale > 1.01) return
    if (activeFailed) {
      auto.error()
      return
    }
    if (!activeReady) {
      auto.wait()
      return
    }
    if (auto.state.status === 'waiting') {
      auto.ready()
      return
    }
    const timer = window.setTimeout(() => {
      if (activeIndex < items.length - 1) {
        controllerRef.current?.slideNext()
        return
      }
      if (nextPage !== null) {
        void loadNext(true)
        return
      }
      if (auto.state.loop) controllerRef.current?.slideTo(0, 0)
      else auto.end()
    }, auto.state.slideSeconds * 1000)
    return () => window.clearTimeout(timer)
  }, [
    activeFailed,
    activeIndex,
    activeReady,
    auto.end,
    auto.error,
    auto.ready,
    auto.state.loop,
    auto.state.mode,
    auto.state.slideSeconds,
    auto.state.status,
    auto.wait,
    items.length,
    loadNext,
    nextPage,
    previewOpen,
    transitioning,
    zoomScale
  ])

  useEffect(() => {
    if (previewOpen || auto.state.mode !== 'scroll' || auto.state.status !== 'running') return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const delta = Math.min(64, now - previous)
      previous = now
      window.scrollBy({ top: (auto.state.scrollSpeed * delta) / 1000, behavior: 'auto' })
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4
      if (atEnd) {
        if (nextPage !== null) void loadNext(true)
        else if (auto.state.loop) window.scrollTo({ top: 0, behavior: 'auto' })
        else {
          setActiveIndex(Math.max(0, items.length - 1))
          auto.end()
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [auto.end, auto.state.loop, auto.state.mode, auto.state.scrollSpeed, auto.state.status, items.length, loadNext, nextPage, previewOpen])

  useEffect(() => {
    const pause = () => auto.pause('manual')
    const pointer = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-auto-browse-controls]')) return
      pause()
    }
    const keydown = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) pause()
    }
    const visibility = () => {
      if (document.hidden) auto.pause('hidden')
    }
    const leave = () => auto.pause('hidden')
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('wheel', pause, { passive: true, capture: true })
    document.addEventListener('touchmove', pointer, { passive: true, capture: true })
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', leave)
    window.addEventListener('pagehide', leave)
    return () => {
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('wheel', pause, true)
      document.removeEventListener('touchmove', pointer, true)
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', leave)
      window.removeEventListener('pagehide', leave)
      auto.pause('hidden')
    }
  }, [auto.pause])

  const reload = async () => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    requestRef.current = null
    auto.reset()
    setPreviewOpen(false)
    setLoadingPage(0)
    setPageError(null)
    setFailedPage(null)
    setReloadFailed(false)
    try {
      const page = await reloadMutation.mutateAsync({ previewId })
      if (!mountedRef.current || generationRef.current !== generation) return
      setPages(new Map([[page.page, page]]))
      setActiveIndex(0)
      setLoadedOrdinals(new Set())
      setFailedOrdinals(new Set())
      setReloadFailed(false)
      window.scrollTo({ top: 0, behavior: 'auto' })
    } catch (error) {
      if (!mountedRef.current || generationRef.current !== generation) return
      setPageError(errorLabel(error))
      setFailedPage(0)
      setReloadFailed(true)
    } finally {
      if (mountedRef.current && generationRef.current === generation) setLoadingPage(null)
    }
  }

  const retryThumbnail = (item: ArchivePreviewThumbnailDto) => {
    auto.recover()
    setLoadedOrdinals((current) => {
      const next = new Set(current)
      next.delete(item.ordinal)
      return next
    })
    setFailedOrdinals((current) => {
      const next = new Set(current)
      next.delete(item.ordinal)
      return next
    })
    setRetryCounts((current) => ({ ...current, [item.ordinal]: (current[item.ordinal] ?? 0) + 1 }))
  }

  const retryFailed = () => {
    if (reloadFailed) {
      void reload()
      return
    }
    if (failedPage !== null) {
      void loadPage(failedPage)
        .then((page) => {
          if (page) auto.recover()
        })
        .catch(() => undefined)
      return
    }
    const retryItem = activeItem && failedOrdinals.has(activeItem.ordinal)
      ? activeItem
      : items.find((item) => failedOrdinals.has(item.ordinal)) ?? activeItem
    if (!retryItem) return
    retryThumbnail(retryItem)
  }

  const skipFailed = () => {
    auto.recover()
    if (activeIndex < items.length - 1) controllerRef.current?.slideNext()
    else if (nextPage !== null) void loadNext(false)
    else auto.end()
  }

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pb-24 pt-5 sm:px-6 sm:pt-8">
      <header className="sticky top-0 z-20 -mx-4 border-b bg-background/92 px-4 pb-4 pt-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <PrivacySensitiveText as="h1" className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
              {title}
            </PrivacySensitiveText>
            <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
              {total === null ? `已载入 ${items.length} 张` : `共 ${total} 张`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="重新读取来源"
              title="重新读取"
              disabled={reloadMutation.isPending}
              onClick={() => void reload()}
            >
              {reloadMutation.isPending ? <LoaderCircleIcon className="motion-safe:animate-spin" /> : <RefreshCwIcon />}
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <a
                href={`/api/archive/preview/${encodeURIComponent(previewId)}/source`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="打开原站"
                title="打开原站"
              >
                <ExternalLinkIcon />
              </a>
            </Button>
          </div>
        </div>
      </header>

      {pageError && (
        <Alert variant="destructive">
          <AlertTitle>暂时无法继续读取</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{pageError}</span>
            <Button type="button" variant="outline" size="sm" disabled={loadingPage !== null} onClick={retryFailed}>
              重试
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!pageError && failedThumbnail && (
        <Alert variant="destructive" data-testid="source-preview-thumbnail-error">
          <AlertTitle>缩略图加载失败</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>第 {failedThumbnail.ordinal + 1} 张缩略图暂时无法显示。</span>
            <Button type="button" variant="outline" size="sm" onClick={() => retryThumbnail(failedThumbnail)}>
              重试
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!items.length && loadingPage !== null ? (
        <div className="flex min-h-[55dvh] items-center justify-center text-muted-foreground" role="status">
          <LoaderCircleIcon className="mr-2 motion-safe:animate-spin" />
          正在读取缩略图
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {items.map((item, index) => (
            <button
              key={item.ordinal}
              ref={(node) => {
                if (node) listNodesRef.current.set(item.ordinal, node)
                else listNodesRef.current.delete(item.ordinal)
              }}
              type="button"
              data-source-preview-ordinal={item.ordinal}
              data-active={index === activeIndex || undefined}
              className="group relative w-full overflow-hidden rounded-lg border bg-card text-left shadow-xs outline-none transition-[border-color,box-shadow,transform] hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50 data-[active]:border-primary/50 data-[active]:shadow-md"
              aria-label={`全屏查看第 ${item.ordinal + 1} 张`}
              onClick={() => {
                auto.pause('overlay')
                setActiveIndex(index)
                setPreviewOpen(true)
              }}
            >
              <span className="absolute left-3 top-3 z-10 rounded-full bg-background/82 px-2.5 py-1 text-xs font-medium tabular-nums text-foreground shadow-xs backdrop-blur-sm">
                {item.ordinal + 1}
              </span>
              <SourcePreviewThumbnail
                key={retryCounts[item.ordinal] ?? 0}
                item={item}
                alt={`来源缩略图 ${item.ordinal + 1}`}
                onLoad={() => setLoadedOrdinals((current) => new Set(current).add(item.ordinal))}
                onError={() => markThumbnailFailed(item.ordinal)}
              />
            </button>
          ))}
          <div ref={sentinelRef} className="flex min-h-16 items-center justify-center text-sm text-muted-foreground">
            {loadingPage !== null ? (
              <span role="status" className="flex items-center gap-2">
                <LoaderCircleIcon className="motion-safe:animate-spin" />
                正在读取下一页
              </span>
            ) : nextPage === null && items.length ? (
              <span>已浏览到末尾</span>
            ) : null}
          </div>
        </div>
      )}

      {items.length > 1 && (
        <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-30 sm:right-6">
          <ControlledAutoBrowseControls
            mode="scroll"
            current={Math.min(activeIndex + 1, items.length)}
            total={total ?? items.length}
            state={auto.state}
            onStart={auto.start}
            onPause={auto.pause}
            onResume={auto.resume}
            onSetControlsCollapsed={auto.setControlsCollapsed}
            onSetPreferences={auto.setPreferences}
            onRestart={() => {
              window.scrollTo({ top: 0, behavior: 'auto' })
              auto.start('scroll')
            }}
            onRetry={retryFailed}
            onSkip={skipFailed}
          />
        </div>
      )}

      {items.length > 0 && (
        <VerticalMediaPreviewCore
          items={items}
          itemKey={(item) => item.ordinal}
          initialIndex={activeIndex}
          open={previewOpen}
          onClose={(finalIndex) => {
            auto.pause('overlay')
            setPreviewOpen(false)
            setActiveIndex(finalIndex)
            const item = items[finalIndex]
            if (item) {
              requestAnimationFrame(() => {
                const node = listNodesRef.current.get(item.ordinal)
                node?.scrollIntoView({ block: 'center' })
                node?.focus({ preventScroll: true })
              })
            }
          }}
          historyKey={SOURCE_PREVIEW_HISTORY_KEY}
          title="来源缩略图全屏预览"
          description="上下滑动或使用上下方向键与翻页键切换，双指或双击缩放。"
          closeLabel="关闭来源预览"
          counterTotal={total}
          testId="source-preview-swiper"
          onControllerChange={(controller) => {
            controllerRef.current = controller
          }}
          onActiveIndexChange={setActiveIndex}
          onZoomChange={(scale) => {
            setZoomScale(scale)
            if (scale > 1.01) auto.pause('zoom')
            else if (auto.state.reason === 'zoom') auto.recover()
          }}
          onTransitioningChange={setTransitioning}
          onManualNavigation={() => auto.pause('manual')}
          onBeforeClose={() => auto.pause('overlay')}
          renderSlide={(item, { eager }) => (
            <div className="swiper-zoom-container flex h-full w-full items-center justify-center px-0 py-16 sm:px-12 sm:py-20">
              <SourcePreviewThumbnail
                key={retryCounts[item.ordinal] ?? 0}
                item={item}
                alt={`来源缩略图 ${item.ordinal + 1}`}
                eager={eager}
                fullscreen
                zoomTarget
                onLoad={() => setLoadedOrdinals((current) => new Set(current).add(item.ordinal))}
                onError={() => markThumbnailFailed(item.ordinal)}
              />
            </div>
          )}
          bottomChrome={({ portalContainer }) => (
            <div className="pointer-events-none absolute inset-x-4 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 flex flex-col items-end gap-2">
              {(activeFailed || (pageError && auto.state.reason !== 'error')) && (
                <div
                  role="alert"
                  data-testid="source-preview-fullscreen-error"
                  className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl border border-destructive/30 bg-background/90 px-3 py-2 text-sm text-foreground shadow-lg backdrop-blur-md"
                >
                  <span>{activeFailed ? '当前缩略图加载失败，请重试。' : pageError}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!activeFailed && loadingPage !== null}
                    onClick={() => (activeFailed && activeItem ? retryThumbnail(activeItem) : retryFailed())}
                  >
                    重试
                  </Button>
                </div>
              )}
              {items.length > 1 && (
                <ControlledAutoBrowseControls
                  mode="slideshow"
                  current={activeIndex + 1}
                  total={total ?? items.length}
                  state={auto.state}
                  container={portalContainer}
                  blocked={zoomScale > 1.01}
                  onStart={auto.start}
                  onPause={auto.pause}
                  onResume={auto.resume}
                  onSetControlsCollapsed={auto.setControlsCollapsed}
                  onSetPreferences={auto.setPreferences}
                  onRestart={() => {
                    controllerRef.current?.slideTo(0, 0)
                    auto.start('slideshow')
                  }}
                  onRetry={retryFailed}
                  onSkip={skipFailed}
                />
              )}
              {auto.state.mode !== 'slideshow' && (
                <span className="self-center rounded-full bg-black/35 px-3 py-1 text-xs text-white/75 backdrop-blur-md">
                  {zoomScale > 1.01 ? `${zoomScale.toFixed(1)}× · 拖动查看，缩小后切换` : '上下切换 · 双指或双击缩放'}
                </span>
              )}
            </div>
          )}
        />
      )}
    </section>
  )
}
