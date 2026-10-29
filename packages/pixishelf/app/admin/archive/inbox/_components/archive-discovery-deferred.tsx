'use client'

import { useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { archiveClientErrorMessage } from '../../_components/archive-client-error'
import { ArchiveIntakeOptionsDialog, DEFAULT_ARCHIVE_INTAKE_OPTIONS } from './archive-intake-options'
import { ArchiveDiscoveryIgnoreDialog } from './archive-discovery-ignore-dialog'
import { formatArchiveUploaderTimestamp } from './archive-uploader-view-state'

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
          <ArchiveIntakeOptionsDialog value={options} onChange={setOptions} disabled={pending} />
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
              <div key={item.id} className="flex flex-wrap items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  aria-label={`选择 ${item.title}`}
                  checked={selected.has(item.id)}
                  disabled={pending || (!selected.has(item.id) && selected.size >= 100)}
                  onCheckedChange={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (checked) next.add(item.id)
                      else next.delete(item.id)
                      return next
                    })
                  }
                />
                <div className="min-w-0 flex-1">
                  <PrivacySensitiveText>
                    <a
                      href={item.sourceHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                      className="break-words hover:underline"
                    >
                      {item.title}
                    </a>
                  </PrivacySensitiveText>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <PrivacySensitiveText>{item.sourceDisplayName}</PrivacySensitiveText>
                    {item.sourceDeleted ? '（来源已删除）' : ''} · {formatArchiveUploaderTimestamp(item.deferredAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => command('restore', [item.id])}>
                    恢复待办
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => setIgnoreSelection({ items: [{ id: item.id, title: item.title }] })}
                  >
                    忽略
                  </Button>
                  <Button size="sm" disabled={pending} onClick={() => command('download', [item.id])}>
                    加入收件箱
                  </Button>
                </div>
              </div>
            ))}
            {query.hasNextPage ? (
              <Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                加载更多
              </Button>
            ) : null}
          </div>
        )}
        {selected.size ? (
          <div className="flex flex-wrap items-center gap-2" role="region" aria-label="稍后决定批量操作">
            <span className="text-sm">已选择 {selected.size} 条</span>
            <Button variant="outline" disabled={pending} onClick={() => command('restore', [...selected])}>
              恢复待办
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                setIgnoreSelection({
                  items: items.filter((item) => selected.has(item.id)).map(({ id, title }) => ({ id, title }))
                })
              }
            >
              忽略
            </Button>
            <Button disabled={pending} onClick={() => command('download', [...selected])}>
              加入收件箱
            </Button>
          </div>
        ) : null}
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
