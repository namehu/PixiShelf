'use client'

import type { ArtworkDedupOperationDto, ArtworkDedupOperationResponseDto } from '@pixishelf/job-contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { useTRPC } from '@/lib/trpc'
import { DuplicateOperationActions } from './duplicate-operation-actions'
import { DuplicateOperationSummary } from './duplicate-operation-summary'
import { DuplicateOperationPreview } from './duplicate-operation-preview'
import { isDuplicateOperationActive, newerDuplicateOperation } from './duplicate-operation-state'
import { DuplicateLoading, DuplicateQueryError } from './duplicate-query-feedback'

export function DuplicateOperationSheet({
  operationId,
  userId,
  onClose,
  onNewOperation
}: {
  operationId: string
  userId: string
  onClose: () => void
  onNewOperation: (operation: ArtworkDedupOperationDto) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const returnFocus = useRef(typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null)
  const options = trpc.artworkDedup.getOperation.queryOptions({ operationId, expectedUserId: userId })
  const query = useQuery({
    ...options,
    retry: false,
    gcTime: 0,
    refetchInterval: (query) =>
      query.state.data && isDuplicateOperationActive(query.state.data.operation) ? 3000 : false,
    structuralSharing: (old, next) => {
      const current = old as ArtworkDedupOperationResponseDto | undefined
      const incoming = next as ArtworkDedupOperationResponseDto
      return current && newerDuplicateOperation(current.operation, incoming.operation) === current.operation
        ? current
        : incoming
    }
  })
  const [previewVersion, setPreviewVersion] = useState<number | null>(null)
  const previewReady = useCallback((version: number | null) => setPreviewVersion(version), [])
  const operation = query.data?.operation
  const refresh = () => {
    void query.refetch()
    void queryClient.invalidateQueries({ queryKey: trpc.artworkDedup.listOperations.queryKey() })
  }
  function update(next: ArtworkDedupOperationDto) {
    queryClient.setQueryData(options.queryKey, (current) => ({
      preview: null,
      operation: newerDuplicateOperation(current?.operation, next)
    }))
    void queryClient.invalidateQueries({ queryKey: trpc.artworkDedup.getOperation.queryKey() })
    void queryClient.invalidateQueries({ queryKey: trpc.artworkDedup.listOperations.queryKey() })
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        className="w-full overflow-hidden pt-[env(safe-area-inset-top)] sm:max-w-[560px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus.current?.focus()
        }}
      >
        <SheetHeader className="shrink-0 gap-1 border-b px-4 py-3 pr-14">
          <SheetTitle className="text-lg">{operation?.mode === 'PREPARE' ? '确认删除' : '删除记录'}</SheetTitle>
          <SheetDescription className="text-xs">
            {operation ? new Date(operation.createdAt).toLocaleString('zh-CN') : '正在读取批次'}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {query.isError ? <DuplicateQueryError busy={query.isFetching} onRetry={refresh} /> : null}
          {query.isPending ? (
            <DuplicateLoading />
          ) : operation ? (
            <>
              <DuplicateOperationSummary operation={operation} />
              {operation.counts.blockedGroups > 0 ? (
                <Alert>
                  <AlertTitle>部分作品无法删除</AlertTitle>
                  <AlertDescription>
                    原件、附件或归属未通过完整核对。此范围不能执行删除，请查看清单原因并重新检查。
                  </AlertDescription>
                </Alert>
              ) : null}
              {operation.failure ? (
                <Alert>
                  <AlertTitle>删除未完成</AlertTitle>
                  <AlertDescription>{operation.failure.message}</AlertDescription>
                </Alert>
              ) : null}
              <DuplicateOperationPreview
                key={`${operation.operationId}:${operation.version}`}
                operation={operation}
                userId={userId}
                disabled={query.isError}
                onUpdate={update}
                onRefresh={refresh}
                onReady={previewReady}
              />
              <DuplicateOperationActions
                operation={operation}
                userId={userId}
                disabled={query.isError || query.isFetching}
                previewReady={previewVersion === operation.version}
                onUpdate={update}
                onNewOperation={onNewOperation}
                onRefresh={refresh}
              />
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
