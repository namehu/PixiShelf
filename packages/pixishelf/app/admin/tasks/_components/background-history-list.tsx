'use client'

import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { ListOrdered, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { backgroundTriggerLabels } from '@/lib/background-job-labels'
import { AdminStatusBadge } from '../../_components/admin-status-badge'
import { formatBackgroundDate, formatBackgroundJobStatus } from './background-task-format'
import { BackgroundHistoryFilters } from './background-history-filters'
import { historyStatusChanged, type HistoryFilters } from './background-history-state'
import type { BackgroundHistoryController } from './use-background-history'

export function BackgroundHistoryList({
  history,
  scrollRef,
  onSelectJob
}: {
  history: BackgroundHistoryController
  scrollRef: RefObject<HTMLDivElement | null>
  onSelectJob: (id: string) => void
}) {
  const { query, items } = history
  const listRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [toolbarHeight, setToolbarHeight] = useState(180)
  const getItemKey = useCallback((index: number) => items[index]!.id, [items])
  const virtualizer = useVirtualizer({
    useFlushSync: false,
    count: items.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => 160,
    overscan: 5,
    scrollMargin,
    scrollPaddingStart: toolbarHeight,
    initialOffset: history.browsing.current.offset,
    initialMeasurementsCache: history.browsing.current.measurements,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range)
      if (focusedIndex !== null) {
        for (const index of [focusedIndex - 1, focusedIndex, focusedIndex + 1]) {
          if (index >= 0 && index < items.length) indices.push(index)
        }
      }
      return [...new Set(indices)].sort((left, right) => left - right)
    }
  })
  const rows = virtualizer.getVirtualItems()
  const visibleKey = rows
    .filter(
      (row) =>
        row.end >= (scrollRef.current?.scrollTop ?? 0) &&
        row.start <= (scrollRef.current?.scrollTop ?? 0) + (scrollRef.current?.clientHeight ?? 0)
    )
    .map((row) => items[row.index]!.id)
    .slice(0, 100)
    .join('\0')

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const measure = () => {
      if (listRef.current) {
        setScrollMargin(
          listRef.current.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
        )
      }
      setToolbarHeight(toolbarRef.current?.offsetHeight ?? 180)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    if (container.firstElementChild) observer.observe(container.firstElementChild)
    if (toolbarRef.current) observer.observe(toolbarRef.current)
    return () => observer.disconnect()
  }, [scrollRef])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    container.scrollTop = history.browsing.current.offset
    const remember = () => {
      history.browsing.current.offset = container.scrollTop
    }
    container.addEventListener('scroll', remember, { passive: true })
    return () => container.removeEventListener('scroll', remember)
  }, [scrollRef, history.browsing])

  useEffect(
    () => () => {
      history.browsing.current.measurements = virtualizer.measurementsCache
    },
    [virtualizer, history.browsing]
  )

  useEffect(() => {
    history.observeIds(visibleKey ? visibleKey.split('\0') : [])
  }, [visibleKey, history.observeIds])

  useEffect(() => {
    const id = history.browsing.current.focusId
    if (!id) return
    const button = listRef.current?.querySelector<HTMLButtonElement>(`[data-job-id="${CSS.escape(id)}"]`)
    if (button) {
      button.focus({ preventScroll: true })
      history.browsing.current.focusId = null
    }
  }, [rows, history.browsing])

  const lastIndex = rows
    .filter((row) => row.start < (scrollRef.current?.scrollTop ?? 0) + (scrollRef.current?.clientHeight ?? 0) + 800)
    .at(-1)?.index
  useEffect(() => {
    if (
      lastIndex !== undefined &&
      lastIndex >= items.length - 5 &&
      query.hasNextPage &&
      !query.isFetching &&
      !query.isError &&
      !history.dateInvalid
    ) {
      void query.fetchNextPage()
    }
  }, [
    lastIndex,
    items.length,
    query.hasNextPage,
    query.isFetching,
    query.isError,
    query.fetchNextPage,
    history.dateInvalid
  ])

  const scrollToRecords = useCallback(() => {
    const container = scrollRef.current
    if (container && toolbarRef.current) {
      const section = toolbarRef.current.parentElement
      if (!section) return
      container.scrollTop += section.getBoundingClientRect().top - container.getBoundingClientRect().top
      history.browsing.current.offset = container.scrollTop
    }
  }, [scrollRef, history.browsing])
  const changeFilters = (filters: HistoryFilters) => {
    history.changeFilters(filters)
    setFocusedIndex(null)
    scrollToRecords()
  }

  return (
    <section id="background-history-section" aria-labelledby="background-history-title" className="min-w-0">
      <div ref={toolbarRef} className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-background p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 id="background-history-title" className="flex items-center gap-2 text-sm font-semibold">
            <ListOrdered className="size-4" aria-hidden="true" />
            执行记录
          </h3>
          <span className="text-xs text-muted-foreground">已加载 {items.length} 条</span>
        </div>
        <BackgroundHistoryFilters
          filters={history.filters}
          onChange={changeFilters}
          dateInvalid={history.dateInvalid}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            history.refresh()
            setFocusedIndex(null)
            scrollToRecords()
          }}
        >
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          {history.hasUpdates ? '记录有更新，点击载入' : '刷新执行记录'}
        </Button>
      </div>
      {history.snapshotError ? (
        <Alert className="my-3">
          <AlertTitle>实时状态暂未同步</AlertTitle>
          <AlertDescription>
            保留最近一次记录。
            <Button type="button" size="sm" variant="ghost" onClick={() => void history.retrySnapshots()}>
              重试状态同步
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div
        ref={listRef}
        className="relative mx-4 sm:mx-5"
        role="list"
        aria-label="执行记录"
        aria-busy={query.isFetching}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {rows.map((row) => {
          const item = items[row.index]!
          return (
            <div
              key={item.id}
              ref={virtualizer.measureElement}
              data-index={row.index}
              role="listitem"
              aria-posinset={row.index + 1}
              aria-setsize={query.hasNextPage ? -1 : items.length}
              className="absolute top-0 left-0 w-full pb-2"
              style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
            >
              <button
                type="button"
                data-job-id={item.id}
                onFocus={() => setFocusedIndex(row.index)}
                onClick={() => {
                  history.browsing.current.focusId = item.id
                  onSelectJob(item.id)
                }}
                className="flex w-full min-w-0 flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ scrollMarginTop: toolbarHeight + 8 }}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{item.label}</span>
                  <AdminStatusBadge status={item.status}>{formatBackgroundJobStatus(item.status)}</AdminStatusBadge>
                </span>
                <span className="break-all font-mono text-[11px] text-muted-foreground">{item.id}</span>
                <span className="text-xs text-muted-foreground">
                  {formatBackgroundDate(item.createdAt)} · {backgroundTriggerLabels[item.triggerSource]} · 优先级{' '}
                  {item.effectivePriority}
                </span>
                {item.parentJobId ? (
                  <span className="break-all text-xs text-muted-foreground">批次子任务 · {item.parentJobId}</span>
                ) : null}
                {item.message ? (
                  <span className="line-clamp-2 break-all text-xs text-muted-foreground">
                    <PrivacySensitiveText>{item.message}</PrivacySensitiveText>
                  </span>
                ) : null}
                {item.error || item.errorCode ? (
                  <span className="line-clamp-2 break-all text-xs text-destructive">
                    <PrivacySensitiveText>
                      {[item.errorCode, item.error].filter(Boolean).join(' · ')}
                    </PrivacySensitiveText>
                  </span>
                ) : null}
                {historyStatusChanged(item, history.filters) ? (
                  <span className="text-xs text-muted-foreground">状态已变更，刷新后移出</span>
                ) : null}
              </button>
            </div>
          )
        })}
      </div>
      <div className="flex min-h-20 items-center justify-center gap-2 p-4" role="status">
        {history.dateInvalid ? (
          '请调整日期范围。'
        ) : query.isPending ? (
          <>
            <Spinner aria-hidden="true" />
            正在读取执行记录…
          </>
        ) : query.isError ? (
          <div className="flex flex-col items-center gap-2 text-sm">
            <p>{items.length ? '更早的记录加载失败，已加载记录仍保留。' : '执行记录加载失败。'}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => (items.length ? void query.fetchNextPage() : void query.refetch())}
            >
              重试加载
            </Button>
          </div>
        ) : query.hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? <Spinner aria-hidden="true" /> : null}加载更多
          </Button>
        ) : items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>没有匹配的执行记录</EmptyTitle>
              <EmptyDescription>请调整筛选或清除搜索。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <p className="text-sm text-muted-foreground">已到底，全部匹配记录已加载。</p>
        )}
      </div>
    </section>
  )
}
