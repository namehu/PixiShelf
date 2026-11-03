'use client'

import { useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { inferRouterOutputs } from '@trpc/server'
import { ArchiveRestoreIcon, BanIcon, ExternalLinkIcon, PlusIcon } from 'lucide-react'
import type { AppRouter } from '@/server'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { archiveClientErrorMessage } from '../../_components/archive-client-error'
import { ArchiveIntakeOptionsDialog, DEFAULT_ARCHIVE_INTAKE_OPTIONS } from './archive-intake-options'
import { ArchiveDiscoveryIgnoreDialog } from './archive-discovery-ignore-dialog'
import { formatArchiveUploaderTimestamp } from './archive-uploader-view-state'
import { ArchiveDiscoverySelectionBar } from './archive-discovery-bulk-bar'
import { ArchiveDiscoverySelectionSurface } from './archive-discovery-selection-surface'

type Result = inferRouterOutputs<AppRouter>['archiveSearch']['restoreDeferredItems']

export function ArchiveDiscoveryDeferred({
  sourceId,
  sourceName,
  onClose
}: {
  sourceId?: string
  sourceName?: string
  onClose: () => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState(new Set<string>())
  const [options, setOptions] = useState(DEFAULT_ARCHIVE_INTAKE_OPTIONS)
  const [issues, setIssues] = useState<string[]>([])
  const [ignoreSelection, setIgnoreSelection] = useState<{ items: { id: string; title: string }[] } | null>(null)
  const attempts = useRef(new Map<string, string>())
  const query = useInfiniteQuery(
    trpc.archiveSearch.listDeferredItems.infiniteQueryOptions(
      { sourceId, limit: 50 },
      { initialCursor: null, getNextPageParam: (page) => page.nextCursor }
    )
  )
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data])
  const finish = async (result: Result) => {
    setIgnoreSelection(null)
    attempts.current.clear()
    setSelected(new Set())
    setIssues(
      result?.items
        .filter((item) => item.result === 'FAILED' || item.result === 'CONFLICT')
        .map((item) => item.message ?? '这条记录暂时无法处理，请刷新后重试') ?? []
    )
    if (result && result.counts.created + result.counts.applied > 0) toast.success('稍后决定已更新')
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listDeferredItems.infiniteQueryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listItems.infiniteQueryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.catalogCounts.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.listIgnoredItems.infiniteQueryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.summary.queryKey() })
    ])
  }
  const onError = (error: unknown) => toast.error(archiveClientErrorMessage(error))
  const restore = useMutation(trpc.archiveSearch.restoreDeferredItems.mutationOptions({ onSuccess: finish, onError }))
  const ignore = useMutation(trpc.archiveSearch.ignoreDeferredItems.mutationOptions({ onSuccess: finish, onError }))
  const download = useMutation(trpc.archiveSearch.downloadDeferredItems.mutationOptions({ onSuccess: finish, onError }))
  const pending = restore.isPending || ignore.isPending || download.isPending
  const command = (action: 'restore' | 'ignore' | 'download', deferredItemIds: string[]) => {
    const key = JSON.stringify([action, [...deferredItemIds].sort(), action === 'download' ? options : null])
    const requestId = attempts.current.get(key) ?? crypto.randomUUID()
    attempts.current.set(key, requestId)
    const input = { deferredItemIds, requestId }
    if (action === 'download') download.mutate({ ...input, ...options })
    else if (action === 'ignore') ignore.mutate(input)
    else restore.mutate(input)
  }
  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (checked && next.size < 100) next.add(id)
      else if (!checked) next.delete(id)
      return next
    })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{sourceId ? '本来源稍后决定' : '全局稍后决定'}</DialogTitle>
          <DialogDescription>
            {sourceName ? <PrivacySensitiveText>{sourceName} · </PrivacySensitiveText> : null}
            暂不下载，不会自动到期。恢复待办保留原筛选决定；加入收件箱成功后移出此列表。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">共 {query.data?.pages[0]?.totalCount ?? '…'} 条</span>
        </div>
        {issues.length ? (
          <Alert variant="destructive">
            <AlertTitle>部分记录未处理</AlertTitle>
            <AlertDescription>{[...new Set(issues)].join('；')}</AlertDescription>
          </Alert>
        ) : null}
        {query.isError ? (
          <Alert variant="destructive">
            <AlertTitle>稍后决定加载失败</AlertTitle>
            <AlertDescription>
              <Button variant="outline" onClick={() => void query.refetch()}>
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : query.isPending ? (
          <p role="status">正在加载稍后决定…</p>
        ) : items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>还没有稍后决定的画廊</EmptyTitle>
              <EmptyDescription>在发现结果中选择“稍后决定”，有空再回来处理。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                aria-label="选择已加载的稍后决定，最多一百条"
                checked={selected.size > 0 && selected.size === Math.min(items.length, 100)}
                disabled={pending}
                onCheckedChange={(checked) =>
                  setSelected(checked ? new Set(items.slice(0, 100).map((item) => item.id)) : new Set())
                }
              />
              选择已加载的画廊（最多 100 条）
            </label>
            {items.map((item) => (
              <ArchiveDiscoverySelectionSurface
                key={item.id}
                itemId={item.id}
                title={item.title}
                checked={selected.has(item.id)}
                disabled={pending || (!selected.has(item.id) && selected.size >= 100)}
                onToggle={(checked) => toggle(item.id, checked)}
                className="flex flex-wrap items-start gap-3 rounded-lg border p-3"
              >
                <Checkbox
                  aria-label={`选择 ${item.title}`}
                  checked={selected.has(item.id)}
                  disabled={pending || (!selected.has(item.id) && selected.size >= 100)}
                  onCheckedChange={(checked) => toggle(item.id, checked === true)}
                />
                <div className="min-w-0 flex-1">
                  <PrivacySensitiveText className="break-words font-medium">{item.title}</PrivacySensitiveText>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <PrivacySensitiveText>{item.sourceDisplayName}</PrivacySensitiveText>
                    {item.sourceDeleted ? '（来源已删除）' : ''} · {formatArchiveUploaderTimestamp(item.deferredAt)}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-9" asChild>
                  <a
                    href={item.sourceHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    aria-label={`打开原站 ${item.title}`}
                  >
                    <ExternalLinkIcon data-icon="inline-start" />
                    原站
                  </a>
                </Button>
              </ArchiveDiscoverySelectionSurface>
            ))}
            {query.hasNextPage ? (
              <Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                加载更多
              </Button>
            ) : null}
          </div>
        )}
        <ArchiveDiscoverySelectionBar
          selectedCount={selected.size}
          pending={pending}
          onClear={() => setSelected(new Set())}
          label="稍后决定批量操作"
          primaryAction={
            <Button aria-label="加入收件箱" disabled={pending} onClick={() => command('download', [...selected])}>
              <PlusIcon data-icon="inline-start" />
              加入收件箱（{selected.size}）
            </Button>
          }
          secondaryAction={
            <Button
              aria-label="恢复待办"
              variant="outline"
              disabled={pending}
              onClick={() => command('restore', [...selected])}
            >
              <ArchiveRestoreIcon data-icon="inline-start" />
              恢复待办（{selected.size}）
            </Button>
          }
          menuItems={
            <DropdownMenuGroup>
              <DropdownMenuItem
                aria-label="忽略"
                disabled={pending}
                onSelect={() =>
                  setIgnoreSelection({
                    items: items.filter((item) => selected.has(item.id)).map(({ id, title }) => ({ id, title }))
                  })
                }
              >
                <BanIcon />
                忽略（{selected.size}）
              </DropdownMenuItem>
            </DropdownMenuGroup>
          }
          options={
            <ArchiveIntakeOptionsDialog
              value={options}
              onChange={setOptions}
              disabled={pending}
              presentation="selection"
            />
          }
        />
        <ArchiveDiscoveryIgnoreDialog
          selection={ignoreSelection}
          pending={pending}
          onClose={() => setIgnoreSelection(null)}
          onConfirm={() => {
            if (ignoreSelection) {
              command(
                'ignore',
                ignoreSelection.items.map((item) => item.id)
              )
            }
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
