'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LibraryBig, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { useDebounce } from '@/hooks/use-debounce'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { PageState } from '@/components/layout/page-state'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { confirm } from '@/components/shared/global-confirm'
import { cn } from '@/lib/utils'
import { AdminWorkbench } from '../../_components/admin-workbench'
import { SeriesDialog } from './series-dialog'
import { PixivSeriesReconciliationDialog } from './pixiv-series-reconciliation-dialog'
import { SeriesEditor, type SeriesEditorHandle } from './series-editor'

const statusLabels = {
  UNCHECKED: '待检查',
  SUCCESS: '成功',
  PARTIAL: '部分成功',
  NO_DATA: '无数据',
  FAILED: '失败'
} as const

export default function SeriesManagement({ initialSeriesId }: { initialSeriesId?: number }) {
  const trpc = useTRPC()
  const router = useRouter()
  const client = useQueryClient()
  const editor = useRef<SeriesEditorHandle>(null)
  const [selectedSeriesId, setSelectedSeriesId] = useState(initialSeriesId)
  useEffect(() => {
    setSelectedSeriesId(initialSeriesId)
  }, [initialSeriesId])
  const lastOpenedId = useRef(initialSeriesId)
  const drawerTitle = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (selectedSeriesId) lastOpenedId.current = selectedSeriesId
  }, [selectedSeriesId])
  const selectSeries = (id?: number) => {
    if (id) lastOpenedId.current = id
    setSelectedSeriesId(id)
    history.pushState(null, '', id ? `/admin/series/${id}` : '/admin/series')
  }
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<'ALL' | 'PIXIV' | 'LOCAL'>('ALL')
  const [status, setStatus] = useState<keyof typeof statusLabels | 'ALL'>('ALL')
  const [createOpen, setCreateOpen] = useState(false)
  const [pixivOpen, setPixivOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const [leaving, setLeaving] = useState(false)
  const debounced = useDebounce(search, 300)
  const list = useQuery(
    trpc.series.list.queryOptions({
      page,
      pageSize: 20,
      query: debounced,
      source,
      pixivStatus: status === 'ALL' ? undefined : status
    })
  )
  const guard = (action: () => void) => {
    if (editor.current?.saving) return
    if (editor.current?.dirty) setPendingAction(() => action)
    else action()
  }
  const guardRef = useRef(guard)
  guardRef.current = guard
  useEffect(() => {
    const currentHref = window.location.href
    const currentState: unknown = history.state
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (editor.current?.dirty || editor.current?.saving) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      const anchor = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href)
      if (
        url.origin !== location.origin ||
        url.pathname === location.pathname ||
        (!editor.current?.dirty && !editor.current?.saving)
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      guardRef.current(() => router.push(url.pathname + url.search + url.hash))
    }
    const pop = (event: PopStateEvent) => {
      if (!editor.current?.dirty && !editor.current?.saving) {
        const match = location.pathname.match(/^\/admin\/series(?:\/(\d+))?$/)
        if (match) setSelectedSeriesId(match[1] ? Number(match[1]) : undefined)
        return
      }
      const destination = location.pathname + location.search + location.hash
      event.stopImmediatePropagation()
      // Keep the editor mounted until its unsaved draft has been resolved.
      history.pushState(currentState, '', currentHref)
      guardRef.current(() => router.push(destination))
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', click, true)
    window.addEventListener('popstate', pop, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', click, true)
      window.removeEventListener('popstate', pop, true)
    }
  }, [router, selectedSeriesId])
  const deletion = useMutation(
    trpc.series.delete.mutationOptions({
      onSuccess: () => {
        toast.success('系列已删除')
        void client.invalidateQueries({ queryKey: trpc.series.list.queryKey() })
        selectSeries()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  return (
    <AdminWorkbench
      title="系列管理"
      description="浏览系列，打开作品抽屉整理归属与阅读顺序。"
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPixivOpen(true)}>
            <LibraryBig data-icon="inline-start" />
            核对 Pixiv
          </Button>
          <Button onClick={() => guard(() => setCreateOpen(true))}>
            <Plus data-icon="inline-start" />
            新建系列
          </Button>
        </div>
      }
    >
      <section
        className="overflow-hidden rounded-surface border bg-background shadow-surface"
        aria-label="系列列表管理"
      >
        <div className="flex flex-col gap-3 border-b bg-surface-muted p-4 sm:p-5 md:flex-row">
          <Input
            className="min-w-0 md:flex-1"
            aria-label="搜索系列"
            placeholder="搜索系列名称…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
          />
          <div className="grid grid-cols-2 gap-3 md:flex">
            <Select
              value={source}
              onValueChange={(value) => {
                setSource(value as typeof source)
                setStatus('ALL')
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full md:w-40" aria-label="筛选系列来源">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="ALL">全部来源</SelectItem>
                  <SelectItem value="LOCAL">本地整理</SelectItem>
                  <SelectItem value="PIXIV">Pixiv 来源</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select
              value={status}
              disabled={source === 'LOCAL'}
              onValueChange={(value) => {
                setStatus(value as typeof status)
                setPage(1)
              }}
            >
              <SelectTrigger className="w-full md:w-44" aria-label="筛选核对状态">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="ALL">全部核对状态</SelectItem>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div
          className="hidden grid-cols-[56px_minmax(0,1fr)_112px_112px_88px_20px] items-center gap-5 border-b px-5 py-3 text-xs text-muted-foreground md:grid"
          aria-hidden="true"
        >
          <span />
          <span>系列</span>
          <span>来源</span>
          <span>核对状态</span>
          <span className="text-right">作品数</span>
          <span />
        </div>
        {list.isLoading ? (
          <PageState variant="loading" title="正在读取系列" compact />
        ) : list.isError ? (
          <PageState variant="error" title="系列加载失败" compact />
        ) : !list.data?.items.length ? (
          <PageState
            variant="empty"
            title="没有匹配的系列"
            description="调整搜索或筛选条件，也可以新建系列。"
            compact
          />
        ) : (
          <ul className="divide-y divide-border/60" aria-label="系列列表">
            {list.data.items.map((item) => (
              <li key={item.id}>
                <button
                  data-series-id={item.id}
                  aria-label={`查看 ${item.title} 的作品`}
                  onClick={() => guard(() => selectSeries(item.id))}
                  className={cn(
                    'grid w-full grid-cols-[56px_minmax(0,1fr)_20px] items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-muted focus-visible:outline-ring sm:gap-5 sm:px-5 md:grid-cols-[56px_minmax(0,1fr)_112px_112px_88px_20px]',
                    selectedSeriesId === item.id && 'bg-accent'
                  )}
                >
                  <Avatar className="size-14 rounded-md">
                    <AvatarImage src={item.coverImageUrl || ''} alt={item.title} className="object-cover" />
                    <AvatarFallback>
                      <LibraryBig className="size-5 text-muted-foreground" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <PrivacySensitiveText className="truncate text-sm font-semibold">{item.title}</PrivacySensitiveText>
                    {item.description ? (
                      <PrivacySensitiveText className="hidden truncate text-xs text-muted-foreground md:block">
                        {item.description}
                      </PrivacySensitiveText>
                    ) : null}
                    <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground md:hidden">
                      <span>{item.artworkCount} 件作品</span>
                      <span>{item.sourceKind === 'PIXIV' ? 'Pixiv 来源' : '本地整理'}</span>
                      {item.pixivSource ? <span>{statusLabels[item.pixivSource.status ?? 'UNCHECKED']}</span> : null}
                    </span>
                  </div>
                  <span className="hidden md:block">
                    <Badge variant={item.sourceKind === 'PIXIV' ? 'secondary' : 'outline'}>
                      {item.sourceKind === 'PIXIV' ? 'Pixiv 来源' : '本地整理'}
                    </Badge>
                  </span>
                  <span className="hidden md:block">
                    {item.pixivSource ? (
                      <Badge variant={item.pixivSource.status === 'FAILED' ? 'destructive' : 'outline'}>
                        {statusLabels[item.pixivSource.status ?? 'UNCHECKED']}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </span>
                  <span className="font-utility hidden text-right text-sm tabular-nums md:block">
                    {item.artworkCount}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-4 sm:px-5">
          <span className="text-xs text-muted-foreground">共 {list.data?.total ?? '—'} 个系列</span>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              aria-label="上一页系列"
              disabled={page === 1 || list.isFetching}
              onClick={() => setPage((value) => value - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="font-utility text-xs tabular-nums text-muted-foreground">
              {page} / {Math.max(1, Math.ceil((list.data?.total ?? 0) / 20))}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="下一页系列"
              disabled={list.isFetching || page * 20 >= (list.data?.total ?? 0)}
              onClick={() => setPage((value) => value + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </section>
      <Sheet
        open={selectedSeriesId !== undefined}
        onOpenChange={(open) => {
          if (!open) guard(() => selectSeries())
        }}
      >
        <SheetContent
          className="w-full gap-0 sm:w-[min(920px,calc(100vw-3rem))] sm:max-w-none"
          closeLabel="返回系列列表"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            drawerTitle.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = document.querySelector<HTMLButtonElement>(`button[data-series-id="${lastOpenedId.current}"]`)
            const fallback = document.querySelector<HTMLInputElement>('input[aria-label="搜索系列"]')
            ;(target ?? fallback)?.focus({ preventScroll: true })
          }}
        >
          <SheetHeader className="shrink-0 border-b px-5 py-4 pr-14">
            <SheetTitle ref={drawerTitle} tabIndex={-1}>
              系列作品
            </SheetTitle>
            <SheetDescription>整理作品归属与阅读顺序，保存更改后生效。</SheetDescription>
          </SheetHeader>
          {selectedSeriesId ? (
            <SeriesEditor
              key={selectedSeriesId}
              ref={editor}
              seriesId={selectedSeriesId}
              onDelete={(id, title) =>
                guard(() =>
                  confirm({
                    title: (
                      <>
                        删除系列“<PrivacySensitiveText>{title}</PrivacySensitiveText>”？
                      </>
                    ),
                    description: '系列记录与归属关系会被删除，作品仍保留在图库中。',
                    variant: 'destructive',
                    confirmText: '删除系列',
                    onConfirm: () => {
                      deletion.mutate(id)
                    }
                  })
                )
              }
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <SeriesDialog open={createOpen} onOpenChange={setCreateOpen} onSuccess={(id) => selectSeries(id)} />
      <PixivSeriesReconciliationDialog
        open={pixivOpen}
        onOpenChange={setPixivOpen}
        onStatusChanged={() => {
          void client.invalidateQueries({ queryKey: trpc.series.list.queryKey() })
        }}
      />
      <AlertDialog
        open={pendingAction !== null}
        onOpenChange={(open) => {
          if (!open && !leaving) setPendingAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>还有未保存的更改</AlertDialogTitle>
            <AlertDialogDescription>保存本轮整理，或放弃草稿后继续。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>继续整理</AlertDialogCancel>
            <Button
              variant="outline"
              disabled={leaving}
              onClick={() => {
                const action = pendingAction
                editor.current?.discard()
                setPendingAction(null)
                action?.()
              }}
            >
              放弃并继续
            </Button>
            <Button
              disabled={leaving}
              onClick={async () => {
                setLeaving(true)
                const saved = await editor.current?.save()
                setLeaving(false)
                if (saved) {
                  const action = pendingAction
                  setPendingAction(null)
                  action?.()
                }
              }}
            >
              保存并继续
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminWorkbench>
  )
}
