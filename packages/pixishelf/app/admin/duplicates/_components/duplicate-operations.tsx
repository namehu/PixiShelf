'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { useTRPC } from '@/lib/trpc'
import { DuplicatePagination } from './duplicate-pagination'
import { DuplicateLoading, DuplicateQueryError } from './duplicate-query-feedback'
import { duplicateOperationLabels, isDuplicateOperationActive } from './duplicate-operation-state'

export function DuplicateOperations({
  userId,
  artistId,
  onOpen
}: {
  userId: string
  artistId: number
  onOpen: (id: string) => void
}) {
  const trpc = useTRPC()
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const query = useQuery({
    ...trpc.artworkDedup.listOperations.queryOptions({
      artistId,
      expectedUserId: userId,
      cursor: cursors.at(-1),
      limit: 20
    }),
    retry: false,
    gcTime: 0,
    refetchInterval: (query) => (query.state.data?.items.some(isDuplicateOperationActive) ? 5000 : false)
  })
  return (
    <div className="py-3">
      {query.isError ? <DuplicateQueryError busy={query.isFetching} onRetry={() => void query.refetch()} /> : null}
      {query.isPending ? (
        <DuplicateLoading />
      ) : query.data ? (
        <>
          {query.data.items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>还没有删除记录</EmptyTitle>
                <EmptyDescription>检查重复作品后，可在这里查看处理结果。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            query.data.items.map((operation) => (
              <button
                key={operation.operationId}
                type="button"
                onClick={() => onOpen(operation.operationId)}
                className="flex min-h-11 w-full items-center gap-3 border-b px-2 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-5 font-medium">
                    {operation.status === 'DELETED'
                      ? `已删除 ${operation.counts.completedCopies} 部，保留 ${operation.counts.keepers} 部`
                      : operation.mode === 'DIRECT_DELETE'
                        ? `已删除 ${operation.counts.completedCopies} 部，${operation.counts.remainingCopies} 部未完成`
                        : `保留 ${operation.counts.keepers} 部，待删除 ${operation.counts.copies} 部`}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {new Date(operation.createdAt).toLocaleString('zh-CN')}
                  </span>
                </span>
                <Badge variant={operation.status === 'DELETED' ? 'info' : 'secondary'} className="shrink-0">
                  {duplicateOperationLabels[operation.status]}
                </Badge>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ))
          )}
          {cursors.length > 1 || query.data.nextCursor ? (
            <DuplicatePagination
              page={cursors.length - 1}
              hasNext={Boolean(query.data.nextCursor)}
              busy={query.isFetching}
              onPrevious={() => setCursors((value) => value.slice(0, -1))}
              onNext={() => {
                const cursor = query.data?.nextCursor
                if (cursor) setCursors((value) => [...value, cursor])
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
