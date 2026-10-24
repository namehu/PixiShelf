'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
    <div className="py-5">
      {query.isError ? <DuplicateQueryError busy={query.isFetching} onRetry={() => void query.refetch()} /> : null}
      {query.isPending ? (
        <DuplicateLoading />
      ) : query.data ? (
        <>
          {query.data.items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>还没有删除记录</EmptyTitle>
                <EmptyDescription>从检查结果选择重复组并预览后，预览和删除批次会保存在这里。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            query.data.items.map((operation) => (
              <div key={operation.operationId} className="flex items-center justify-between gap-4 border-b py-5">
                <div>
                  <h2 className="text-sm font-medium">{duplicateOperationLabels[operation.status]}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {operation.counts.selectedGroups} 组 · {operation.counts.copies} 部副本
                  </p>
                  {operation.mode === 'DIRECT_DELETE' ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      已完成 {operation.counts.completedCopies} 部 · 未完成 {operation.counts.remainingCopies} 部 · 已删{' '}
                      {BigInt(operation.counts.deletedFiles).toLocaleString()} 个文件
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(operation.createdAt).toLocaleString('zh-CN')}
                  </p>
                </div>
                <Button variant="ghost" className="min-h-11 shrink-0" onClick={() => onOpen(operation.operationId)}>
                  查看批次
                </Button>
              </div>
            ))
          )}
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
        </>
      ) : null}
    </div>
  )
}
