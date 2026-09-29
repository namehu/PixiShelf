'use client'

import { useEffect, useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { AdminSection, AdminSectionHeader } from '@/app/admin/_components/admin-workbench'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { toast } from 'sonner'

const storageKey = 'discovery-pending-cancel-request'
export function DiscoveryPendingCreators({ onBack }: { onBack: () => void }) {
  const trpc = useTRPC()
  const client = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [request, setRequest] = useState<{ pendingIds: string[]; requestId: string } | null>(null)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved) setRequest(JSON.parse(saved))
    } catch {
      /* Optional recovery. */
    }
  }, [])
  const query = useInfiniteQuery(
    trpc.archiveSearch.listPendingCreators.infiniteQueryOptions(
      { limit: 50 },
      { getNextPageParam: (page) => page.nextCursor, refetchInterval: 5000 }
    )
  )
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const cancel = useMutation(
    trpc.archiveSearch.cancelPendingCreators.mutationOptions({
      onSuccess: async (result) => {
        setRequest(null)
        try {
          sessionStorage.removeItem(storageKey)
        } catch {
          /* Optional recovery. */
        }
        setSelected(
          new Set(
            result?.items
              .filter((row) => row.result === 'FAILED' || row.result === 'CONFLICT')
              .map((row) => row.targetId)
          )
        )
        toast.success(
          `已取消 ${result?.counts.applied ?? 0} 条，跳过 ${result?.counts.skipped ?? 0} 条，失败 ${result?.counts.failed ?? 0} 条`
        )
        await Promise.all([
          client.invalidateQueries({ queryKey: trpc.archiveSearch.listPendingCreators.infiniteQueryKey() }),
          client.invalidateQueries({ queryKey: trpc.archiveSearch.listItems.infiniteQueryKey() })
        ])
      },
      onError: () => toast.error('结果尚未确认，请重试原操作')
    })
  )
  const submit = () => {
    const next = request ?? { pendingIds: [...selected], requestId: crypto.randomUUID() }
    setRequest(next)
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      /* In-memory retry remains available. */
    }
    cancel.mutate(next)
  }
  return (
    <AdminSection>
      <AdminSectionHeader
        title="待生效绑定"
        description="每条表示一个画廊与艺术家的绑定；来源删除后仍保留，归档成功后自动生效。"
        actions={
          <Button variant="outline" onClick={onBack}>
            返回发现来源
          </Button>
        }
      />
      {query.isError ? (
        <Alert variant="destructive">
          <AlertTitle>读取失败</AlertTitle>
          <AlertDescription>
            <Button variant="outline" onClick={() => void query.refetch()}>
              重试
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox
          aria-label="选择已加载待生效绑定，最多一百条"
          checked={items.length > 0 && items.slice(0, 100).every((row) => selected.has(row.id))}
          onCheckedChange={(checked) =>
            setSelected(checked ? new Set(items.slice(0, 100).map((row) => row.id)) : new Set())
          }
        />
        <span>选择已加载（最多 100 条）</span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((row) => (
          <div key={row.id} className="flex items-center gap-3 rounded-lg border p-3">
            <Checkbox
              aria-label={`选择绑定 ${row.externalId} ${row.artist.name}`}
              checked={selected.has(row.id)}
              disabled={cancel.isPending || (!selected.has(row.id) && selected.size >= 100)}
              onCheckedChange={(checked) =>
                setSelected((current) => {
                  const next = new Set(current)
                  if (checked) next.add(row.id)
                  else next.delete(row.id)
                  return next
                })
              }
            />
            <div className="flex min-w-0 flex-col gap-1">
              <PrivacySensitiveText>{row.title}</PrivacySensitiveText>
              <PrivacySensitiveText>
                {row.artist.name} · #{row.externalId}
              </PrivacySensitiveText>
            </div>
          </div>
        ))}
        {!query.isPending && !query.isError && !items.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>没有待生效绑定</EmptyTitle>
              <EmptyDescription>在来源结果中绑定尚未归档的作品后，会显示在这里。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {query.isPending ? <p role="status">正在读取…</p> : null}
        {query.hasNextPage ? (
          <Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            加载更多
          </Button>
        ) : null}
      </div>
      <div className="sticky bottom-4 flex flex-wrap gap-2 rounded-lg border bg-background p-3">
        <Button disabled={cancel.isPending || (!request && !selected.size)} onClick={submit}>
          {request ? '重试确认原操作' : `取消待生效绑定（${selected.size}）`}
        </Button>
        <Button variant="outline" onClick={() => setSelected(new Set())} disabled={cancel.isPending}>
          清除选择
        </Button>
      </div>
    </AdminSection>
  )
}
