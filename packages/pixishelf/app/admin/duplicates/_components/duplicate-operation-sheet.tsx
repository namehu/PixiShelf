'use client'

import type { ArtworkDedupOperationDto, ArtworkDedupOperationResponseDto } from '@pixishelf/job-contracts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { useTRPC } from '@/lib/trpc'
import { DuplicateOperationActions } from './duplicate-operation-actions'
import { DuplicateOperationPreview } from './duplicate-operation-preview'
import {
  duplicateBytes,
  duplicateOperationLabels,
  duplicateDiagnosticCode,
  isDirectDeletePreview,
  isDuplicateOperationActive,
  newerDuplicateOperation
} from './duplicate-operation-state'
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
        className="w-full overflow-y-auto pt-[env(safe-area-inset-top)] sm:max-w-[560px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus.current?.focus()
        }}
      >
        <SheetHeader className="pr-14">
          <SheetTitle>{operation ? duplicateOperationLabels[operation.status] : '批次详情'}</SheetTitle>
          <SheetDescription>
            {operation ? new Date(operation.createdAt).toLocaleString('zh-CN') : '正在读取批次'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {query.isError ? <DuplicateQueryError busy={query.isFetching} onRetry={refresh} /> : null}
          {query.isPending ? (
            <DuplicateLoading />
          ) : operation ? (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">实际范围</dt>
                  <dd className="mt-1 font-medium">
                    {operation.counts.selectedGroups} 组 · {operation.counts.copies} 部副本
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">保留作品</dt>
                  <dd className="mt-1 font-medium">{operation.counts.keepers} 部</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">已检查文件</dt>
                  <dd className="mt-1 font-medium">{BigInt(operation.counts.preparedFiles).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">逻辑大小</dt>
                  <dd className="mt-1 font-medium">{duplicateBytes(operation.counts.logicalBytes)}</dd>
                </div>
              </dl>
              {operation.counts.excludedGroups > 0 || operation.counts.blockedGroups > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {operation.counts.excludedGroups} 组已排除，{operation.counts.blockedGroups} 组无法处理。
                </p>
              ) : null}
              {operation.validatedAt ? (
                <p className="text-xs text-muted-foreground">
                  核对于 {new Date(operation.validatedAt).toLocaleString('zh-CN')}。执行前会再次检查。
                </p>
              ) : null}
              {operation.status === 'BUILDING' ? (
                <p role="status" className="text-sm text-muted-foreground">
                  正在检查作品和文件，离开页面后会继续。
                </p>
              ) : null}
              {isDirectDeletePreview(operation) && operation.mode === 'DIRECT_DELETE' ? (
                <div role="status" aria-live="polite" className="flex flex-col gap-2 text-sm text-muted-foreground">
                  <p>
                    {operation.deleteStartedAt
                      ? '已进入不可逆删除阶段；已删文件无法撤销。'
                      : operation.status === 'CANCELLED'
                        ? '本次处理已取消，未开始删除。'
                        : '尚未开始删除；将等待相关写入退出，并完整复核全部所选组。'}
                  </p>
                  <p>
                    已删 {BigInt(operation.counts.deletedFiles).toLocaleString()} 个文件 · 待完成{' '}
                    {BigInt(operation.counts.remainingFiles).toLocaleString()} 个文件
                  </p>
                  <p>
                    已完成 {operation.counts.completedCopies} 部副本 · 未完成 {operation.counts.remainingCopies} 部 ·
                    阻断 {operation.counts.blockedCopies} 部
                  </p>
                  {operation.counts.deleteIntentFiles !== '0' ? (
                    <p>
                      已进入删除意图的文件 {BigInt(operation.counts.deleteIntentFiles).toLocaleString()}{' '}
                      个；未决意图可能已删除，不能按剩余数推断现场。
                    </p>
                  ) : null}
                </div>
              ) : null}
              {operation.counts.blockedGroups > 0 ? (
                <Alert>
                  <AlertTitle>本批次存在阻断</AlertTitle>
                  <AlertDescription>
                    原件、附件或归属未通过完整核对。此范围不能执行删除，请查看清单原因并重新检查。
                  </AlertDescription>
                </Alert>
              ) : null}
              {operation.failure ? (
                <Alert>
                  <AlertTitle>本批次需要处理</AlertTitle>
                  <AlertDescription>
                    {operation.failure.message}
                    <details>
                      <summary className="flex min-h-11 cursor-pointer items-center">诊断信息</summary>
                      <p className="text-xs">{duplicateDiagnosticCode(operation.failure.code)}</p>
                    </details>
                  </AlertDescription>
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
