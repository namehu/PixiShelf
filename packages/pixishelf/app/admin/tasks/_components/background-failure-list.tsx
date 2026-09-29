'use client'

import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { BellOff, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { confirm } from '@/components/shared/global-confirm'
import type { BackgroundControlsView } from './background-task-console'
import { formatBackgroundDate } from './background-task-format'
import { MAX_SELECTED_FAILURES, type BackgroundFailuresController } from './use-background-failures'

export function BackgroundFailureList({
  failures,
  totalCount,
  controls,
  scrollRef,
  onSelectJob,
  onViewHistory
}: {
  failures: BackgroundFailuresController
  totalCount: number
  controls: BackgroundControlsView
  scrollRef: RefObject<HTMLDivElement | null>
  onSelectJob: (id: string) => void
  onViewHistory: () => void
}) {
  const { items, query, selectedIds } = failures
  const listRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [toolbarHeight, setToolbarHeight] = useState(180)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const getItemKey = useCallback((index: number) => items[index]!.id, [items])
  const virtualizer = useVirtualizer({
    useFlushSync: false,
    count: items.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => 175,
    overscan: 5,
    scrollMargin,
    scrollPaddingStart: toolbarHeight,
    initialOffset: failures.browsing.current.offset,
    initialMeasurementsCache: failures.browsing.current.measurements,
    rangeExtractor: (range) => {
      const indices = defaultRangeExtractor(range)
      if (focusedIndex !== null) {
        for (const index of [focusedIndex - 1, focusedIndex, focusedIndex + 1]) {
          if (index >= 0 && index < items.length) indices.push(index)
        }
      }
      return [...new Set(indices)].sort((a, b) => a - b)
    }
  })
  const rows = virtualizer.getVirtualItems()
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
    if (toolbarRef.current) observer.observe(toolbarRef.current)
    return () => observer.disconnect()
  }, [scrollRef, query.isPending])
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    container.scrollTop = failures.browsing.current.offset
    setFocusedIndex(null)
    const remember = () => {
      failures.browsing.current.offset = container.scrollTop
    }
    container.addEventListener('scroll', remember, { passive: true })
    return () => container.removeEventListener('scroll', remember)
  }, [scrollRef, failures.browsing, failures.generation])
  useEffect(
    () => () => {
      failures.browsing.current.measurements = virtualizer.measurementsCache
    },
    [virtualizer, failures.browsing]
  )
  useEffect(() => {
    const id = failures.browsing.current.focusId
    if (!id) return
    const button = listRef.current?.querySelector<HTMLButtonElement>(`[data-failure-detail="${CSS.escape(id)}"]`)
    if (button) {
      button.focus({ preventScroll: true })
      failures.browsing.current.focusId = null
    }
  }, [rows, failures.browsing])

  const pending = controls.acknowledge.isPending || controls.acknowledgeMany.isPending || controls.retry.isPending
  const selectable = items.slice(0, MAX_SELECTED_FAILURES)
  const allSelected = selectable.length > 0 && selectable.every(({ id }) => selectedIds.has(id))
  const ignoreAll = () =>
    confirm({
      title: '忽略全部失败提醒？',
      description: `将忽略所有待处理失败提醒，包括未展示记录。当前显示 ${totalCount} 项，实际数量以执行时为准；失败记录仍保留。`,
      confirmText: '全部忽略',
      onConfirm: async () => {
        await controls.acknowledgeMany.mutateAsync({ scope: 'all' })
      }
    })

  return (
    <section aria-label="待处理失败" className="min-w-0">
      <div ref={toolbarRef} className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-background p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">待处理失败（{totalCount}）</h3>
          <Button size="sm" variant="outline" disabled={pending || totalCount === 0} onClick={ignoreAll}>
            <BellOff data-icon="inline-start" aria-hidden="true" />
            全部忽略（{totalCount}）
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">忽略只关闭提醒，失败状态、错误和执行记录仍保留。</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={allSelected ? true : selectedIds.size > 0 ? 'indeterminate' : false}
              disabled={pending || items.length === 0 || query.isPending}
              onCheckedChange={(checked) => failures.selectLoaded(checked === true)}
            />
            全选已加载
          </label>
          <Button
            size="sm"
            disabled={pending || selectedIds.size === 0 || query.isPending}
            onClick={() => controls.acknowledgeMany.mutate({ scope: 'selected', jobIds: [...selectedIds] })}
          >
            {controls.acknowledgeMany.isPending ? (
              <Spinner data-icon="inline-start" aria-hidden="true" />
            ) : (
              <BellOff data-icon="inline-start" aria-hidden="true" />
            )}
            忽略所选（{selectedIds.size}）
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || selectedIds.size === 0}
            onClick={failures.clearSelection}
          >
            清空选择
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || query.isFetching}
            onClick={() => failures.refresh()}
            aria-label="刷新失败列表"
          >
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            刷新
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          已加载 {items.length} 条 · 单次最多选择 {MAX_SELECTED_FAILURES} 条；全选范围为已加载列表前{' '}
          {MAX_SELECTED_FAILURES} 条。
        </p>
        {failures.hasUpdates ? (
          <Button size="sm" variant="outline" disabled={pending || query.isFetching} onClick={() => failures.refresh()}>
            失败列表有更新，刷新查看
          </Button>
        ) : null}
      </div>
      {query.isPending ? (
        <div role="status" className="flex items-center gap-2 p-5">
          <Spinner />
          正在读取失败记录…
        </div>
      ) : null}
      {query.isError ? (
        <Alert variant="destructive" className="my-3">
          <AlertTitle>失败记录加载失败</AlertTitle>
          <AlertDescription>
            <PrivacySensitiveText>{query.error.message}</PrivacySensitiveText>
            <Button
              size="sm"
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void (items.length ? query.fetchNextPage() : query.refetch())}
            >
              重试加载
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!query.isPending && !query.isError && items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>暂无待处理失败</EmptyTitle>
            <EmptyDescription>已忽略的失败仍可在执行历史中查看。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      <div
        ref={listRef}
        role="list"
        aria-label="失败记录"
        className="relative mx-4 sm:mx-5"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {rows.map((row) => {
          const item = items[row.index]!
          return (
            <article
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              role="listitem"
              onFocusCapture={() => setFocusedIndex(row.index)}
              className="absolute left-0 top-0 w-full pb-2"
              style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
            >
              <div className="flex gap-3 rounded-lg border p-3">
                <label className="flex min-w-6 cursor-pointer items-start pt-1">
                  <Checkbox
                    aria-label={`选择失败任务 ${item.id}`}
                    checked={selectedIds.has(item.id)}
                    disabled={pending || (!selectedIds.has(item.id) && selectedIds.size >= MAX_SELECTED_FAILURES)}
                    onCheckedChange={(checked) => failures.toggle(item.id, checked === true)}
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="mt-1 select-text break-all font-mono text-[11px] text-muted-foreground">{item.id}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatBackgroundDate(item.createdAt)}
                    {item.errorCode ? ` · ${item.errorCode}` : ''}
                  </p>
                  {item.error ? (
                    <PrivacySensitiveText as="p" className="mt-1 line-clamp-2 break-words text-xs text-destructive">
                      {item.error}
                    </PrivacySensitiveText>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      data-failure-detail={item.id}
                      onClick={() => {
                        failures.browsing.current.focusId = item.id
                        onSelectJob(item.id)
                      }}
                    >
                      查看详情
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => controls.acknowledge.mutate({ jobId: item.id })}
                    >
                      <BellOff data-icon="inline-start" aria-hidden="true" />
                      忽略提醒
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-2 p-4 sm:p-5">
        {query.hasNextPage ? (
          <Button variant="outline" disabled={query.isFetching || pending} onClick={() => void query.fetchNextPage()}>
            {query.isFetchingNextPage ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}加载更多
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onViewHistory}>
          查看失败历史
        </Button>
      </div>
    </section>
  )
}
