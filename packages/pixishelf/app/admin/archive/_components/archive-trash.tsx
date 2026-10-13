'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { SourcePreviewButton } from '@/components/source-preview/source-preview-button'
import { AdminWorkbench } from '../../_components/admin-workbench'
import { archiveSourceLabel } from './archive-source-label'

type Cursor = { deletedAt: string; id: number }

export function ArchiveTrash() {
  const trpc = useTRPC()
  const cache = useQueryClient()
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [pages, setPages] = useState<Array<Cursor | undefined>>([undefined])
  const [selected, setSelected] = useState<number[]>([])
  const restoreKeys = useRef(new Map<string, string>())
  const [feedback, setFeedback] = useState<Array<{ targetId: string; result: string; message: string | null }>>([])
  const query = useQuery(
    trpc.archive.listTrash.queryOptions({ search, cursor: pages.at(-1), limit: 50 }, { refetchInterval: 5000 })
  )
  // Worker completion changes the trash result after the command has already returned.
  useEffect(() => {
    if (query.data) void cache.invalidateQueries({ queryKey: trpc.archiveSearch.pathKey() })
  }, [query.data, cache, trpc])
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: trpc.archive.pathKey() })
    await cache.invalidateQueries({ queryKey: trpc.archiveSearch.pathKey() })
    await cache.invalidateQueries({ queryKey: trpc.archiveUploader.pathKey() })
  }
  const restore = useMutation(
    trpc.archive.restoreTrash.mutationOptions({
      onSuccess: async (result, input) => {
        restoreKeys.current.delete([...input.artworkIds].sort((a, b) => a - b).join(','))
        setFeedback(result?.items ?? [])
        setSelected([])
        await refresh()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const retry = useMutation(
    trpc.archive.retryTrash.mutationOptions({
      onSuccess: async () => {
        toast.success('已重新提交维护任务')
        await refresh()
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const items = query.data?.items ?? []
  const eligible = items.filter((item) => item.canRestore).map((item) => item.id)
  const picked = selected.filter((id) => eligible.includes(id))
  const pending = restore.isPending || retry.isPending
  const restoreIds = (artworkIds: number[]) => {
    const key = [...artworkIds].sort((a, b) => a - b).join(',')
    const idempotencyKey = restoreKeys.current.get(key) ?? `archive-restore:${createBrowserUuid()}`
    restoreKeys.current.set(key, idempotencyKey)
    restore.mutate({ artworkIds, idempotencyKey })
  }
  return (
    <AdminWorkbench
      title="回收站"
      eyebrow={null}
      contentClassName="flex flex-col gap-4"
      actions={
        <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
          刷新
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        共 {query.data?.count ?? '…'} 件作品。删除后保留 7 天，到期由后台永久清理。
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setSearch(draft.trim())
          setPages([undefined])
          setSelected([])
        }}
      >
        <Input
          aria-label="搜索回收站"
          placeholder="搜索标题或来源 ID"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="outline">
          <Search data-icon="inline-start" />
          搜索
        </Button>
      </form>
      <div className="flex items-center gap-3">
        <Checkbox
          aria-label="选择本页可恢复作品"
          disabled={!eligible.length || pending}
          checked={
            picked.length > 0 && picked.length === eligible.length ? true : picked.length ? 'indeterminate' : false
          }
          onCheckedChange={(checked) => setSelected(checked ? eligible : [])}
        />
        <span className="text-sm">已选 {picked.length} 件</span>
        <Button variant="outline" disabled={!picked.length || pending} onClick={() => restoreIds(picked)}>
          <RotateCcw data-icon="inline-start" />
          恢复所选
        </Button>
      </div>
      {feedback.length > 0 && (
        <Alert>
          <AlertTitle>恢复提交结果</AlertTitle>
          <AlertDescription>
            <ul>
              {feedback.map((item) => (
                <li key={item.targetId}>
                  作品 #{item.targetId}：{item.message ?? item.result}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>无法读取回收站</AlertTitle>
          <AlertDescription>请稍后刷新重试。</AlertDescription>
        </Alert>
      ) : query.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !items.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trash2 />
            </EmptyMedia>
            <EmptyTitle>{search ? '没有匹配的作品' : '回收站为空'}</EmptyTitle>
            <EmptyDescription>移入回收站的归档作品会显示在这里。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="divide-y rounded-lg border">
          {items.map((item) => {
            const expired = item.purgeAfter && new Date(item.purgeAfter).getTime() <= Date.now()
            const failed = item.maintenance && ['FAILED', 'CANCELLED'].includes(item.maintenance.status)
            const label = failed
              ? '维护失败'
              : item.lifecycleState === 'TRASHING'
                ? '正在移入回收站'
                : item.lifecycleState === 'RESTORING'
                  ? '正在恢复'
                  : expired
                    ? '等待清理'
                    : '已删除'
            return (
              <article key={item.id} className="flex items-start gap-3 p-4">
                <Checkbox
                  className="mt-1"
                  aria-label={`选择作品 ${item.title}`}
                  disabled={!item.canRestore || pending}
                  checked={picked.includes(item.id)}
                  onCheckedChange={(checked) =>
                    setSelected((value) => (checked ? [...value, item.id] : value.filter((id) => id !== item.id)))
                  }
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <PrivacySensitiveText className="truncate font-medium">{item.title}</PrivacySensitiveText>
                  <PrivacySensitiveText className="text-xs text-muted-foreground">
                    {item.sources
                      .map((source) => archiveSourceLabel(source.providerKey, source.externalId))
                      .join(' · ')}
                  </PrivacySensitiveText>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={failed ? 'destructive' : 'muted'}>{label}</Badge>
                    <span>删除于 {new Date(item.deletedAt).toLocaleString()}</span>
                    <span>
                      {expired ? '清理期限' : '预计清理'}：
                      {item.purgeAfter ? new Date(item.purgeAfter).toLocaleString() : '待确认'}
                    </span>
                  </div>
                  {failed && <p className="text-sm text-destructive">维护未完成，可重试或前往后台任务查看详情。</p>}
                  <div className="flex flex-wrap gap-2">
                    {item.canRestore && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => restoreIds([item.id])}>
                        <RotateCcw data-icon="inline-start" />
                        恢复
                      </Button>
                    )}
                    {item.canRetry && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          retry.mutate({
                            artworkId: item.id,
                            action:
                              item.lifecycleState === 'TRASHING'
                                ? 'TRASH_ARCHIVE'
                                : item.lifecycleState === 'RESTORING'
                                  ? 'RESTORE_ARCHIVE'
                                  : 'PURGE_ARCHIVE'
                          })
                        }
                      >
                        重试维护
                      </Button>
                    )}
                    {item.taskId && (
                      <SourcePreviewButton size="sm" variant="ghost" source={{ kind: 'task', taskId: item.taskId }} />
                    )}
                    {item.maintenance && (
                      <Button size="sm" variant="ghost" asChild>
                        <a href={`/admin/tasks?jobId=${encodeURIComponent(item.maintenance.id)}`}>维护详情</a>
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">第 {pages.length} 页 · 每页最多 50 件</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={pages.length === 1 || query.isFetching}
            onClick={() => {
              setPages((value) => value.slice(0, -1))
              setSelected([])
            }}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!query.data?.nextCursor || query.isFetching}
            onClick={() => {
              if (query.data?.nextCursor) setPages((value) => [...value, query.data!.nextCursor!])
              setSelected([])
            }}
          >
            下一页
          </Button>
        </div>
      </div>
    </AdminWorkbench>
  )
}
