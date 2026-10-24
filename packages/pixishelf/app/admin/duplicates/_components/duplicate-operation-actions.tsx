'use client'

import type { ArtworkDedupOperationDto } from '@pixishelf/job-contracts'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useTRPC } from '@/lib/trpc'
import { DuplicateDeleteConsent } from './duplicate-delete-consent'
import { isDirectDeletePreview } from './duplicate-operation-state'
import { useDuplicateIntent } from './use-duplicate-intent'

type Props = {
  operation: ArtworkDedupOperationDto
  userId: string
  disabled: boolean
  previewReady: boolean
  onUpdate: (operation: ArtworkDedupOperationDto) => void
  onNewOperation: (operation: ArtworkDedupOperationDto) => void
  onRefresh: () => void
}
export function DuplicateOperationActions(props: Props) {
  const { operation, userId } = props
  return (
    <OperationActions
      key={`${userId}:${operation.operationId}:${operation.version}:${operation.scopeDigest}`}
      {...props}
    />
  )
}
function OperationActions({ operation, userId, disabled, previewReady, onUpdate, onNewOperation, onRefresh }: Props) {
  const trpc = useTRPC()
  const intent = useDuplicateIntent()
  const directDelete = useMutation(trpc.artworkDedup.directDelete.mutationOptions())
  const retry = useMutation(trpc.artworkDedup.retryOperation.mutationOptions())
  const cancel = useMutation(trpc.artworkDedup.cancelOperation.mutationOptions())
  const reprepare = useMutation(trpc.artworkDedup.prepareCleanup.mutationOptions())
  const busy = intent.pending.size > 0
  const can = (action: ArtworkDedupOperationDto['allowedActions'][number]) => operation.allowedActions.includes(action)
  const command = { operationId: operation.operationId, expectedVersion: operation.version, expectedUserId: userId }
  function submit(action: string, request: (key: string) => Promise<ArtworkDedupOperationDto>, createNew = false) {
    if (disabled || busy) return
    void intent.execute(
      'operation',
      JSON.stringify([command, operation.scopeDigest, action]),
      request,
      (next) => {
        if (createNew) onNewOperation(next)
        else onUpdate(next)
      },
      onRefresh
    )
  }
  if (!isDirectDeletePreview(operation)) {
    return (
      <Alert>
        <AlertTitle>此预览不能用于直接删除</AlertTitle>
        <AlertDescription>
          这是旧流程的记录，不包含本次删除授权。请返回检查结果，重新选择并预览删除。
          <Button asChild variant="outline" className="min-h-11 w-fit">
            <Link
              href={`/admin/duplicates?artistId=${operation.artistId}&runId=${encodeURIComponent(operation.runId)}&entry=direct`}
            >
              返回检查结果
            </Link>
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  const canDelete =
    can('DIRECT_DELETE') &&
    operation.mode === 'PREPARE' &&
    operation.status === 'READY' &&
    Boolean(operation.scopeDigest) &&
    operation.counts.blockedGroups === 0 &&
    operation.counts.copies > 0
  return (
    <section className="flex flex-col gap-4 border-t pt-5" aria-label="批次操作">
      {intent.failed.size > 0 ? (
        <Alert>
          <AlertTitle>提交结果尚未确认</AlertTitle>
          <AlertDescription>
            正在查询同一批次。请核对最新状态后重试；重复提交会复用同一意图，不会另建删除批次。
          </AlertDescription>
        </Alert>
      ) : null}
      {operation.status === 'STALE' ? (
        <p className="text-sm text-muted-foreground">
          作品或保留选择已变化，原预览不能执行。重新预览原组范围后，再确认新的影响。
        </p>
      ) : null}
      {['RECOVERY_REQUIRED', 'STOPPED'].includes(operation.status) ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {operation.deleteStartedAt
            ? '部分文件可能已删除，副本保持不可见。已删文件无法撤销；只可复核保留作品并继续原删除范围，不能换保留者或扩大范围。'
            : '尚未开始删除。可重试原范围，或取消本次处理；以服务器核实结果为准。'}
        </p>
      ) : null}
      {operation.stopRequested && !['CANCELLED', 'STOPPED', 'DELETED'].includes(operation.status) ? (
        <p role="status" className="text-sm text-muted-foreground">
          {operation.deleteStartedAt
            ? '已请求停止，正在等待安全文件边界和执行退出；已删除文件无法撤销。'
            : '已请求取消，正在核实执行退出与删除意图。结果确认前请继续保持外部停写。'}
        </p>
      ) : null}
      {canDelete ? (
        <DuplicateDeleteConsent
          copyCount={operation.counts.copies}
          busy={busy}
          disabled={disabled || !previewReady}
          onConfirm={() => {
            if (!previewReady || !operation.scopeDigest) return
            submit('direct-delete', (key) =>
              directDelete.mutateAsync({
                ...command,
                purpose: 'DIRECT_DELETE',
                protocolVersion: 1,
                scopeDigest: operation.scopeDigest!,
                permanentDeleteConfirmed: true,
                organizationImpactConfirmed: true,
                externalWritesStopped: true,
                idempotencyKey: key
              })
            )
          }}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {can('REPREPARE') && operation.mode === 'PREPARE' ? (
          <Button
            className="min-h-11"
            disabled={disabled || busy}
            onClick={() =>
              submit(
                'reprepare',
                (key) =>
                  reprepare.mutateAsync({
                    sourceOperationId: operation.operationId,
                    expectedOperationVersion: operation.version,
                    purpose: 'DIRECT_DELETE',
                    protocolVersion: 1,
                    expectedUserId: userId,
                    idempotencyKey: key
                  }),
                true
              )
            }
          >
            重新预览原范围
          </Button>
        ) : null}
        {can('RETRY_PREPARE') || can('RETRY_OPERATION') ? (
          <Button
            className="min-h-11"
            disabled={disabled || busy}
            onClick={() => submit('retry', (key) => retry.mutateAsync({ ...command, idempotencyKey: key }))}
          >
            {operation.mode === 'DIRECT_DELETE' ? '复核并继续原删除' : '重试原范围预览'}
          </Button>
        ) : null}
        {can('CANCEL') || can('STOP') ? (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={disabled || busy || operation.stopRequested}
            onClick={() => submit('stop', (key) => cancel.mutateAsync({ ...command, idempotencyKey: key }))}
          >
            {operation.deleteStartedAt ? '请求停止' : '取消本次处理'}
          </Button>
        ) : null}
      </div>
      {operation.status === 'READY' && operation.mode === 'PREPARE' && !can('DIRECT_DELETE') ? (
        <p role="status" className="text-sm text-muted-foreground">
          本批次当前不可执行删除，请核对登录账户和能力开放状态。
        </p>
      ) : null}
      {canDelete && !previewReady ? (
        <p role="status" className="text-sm text-muted-foreground">
          请先载入并核对批次清单，才能确认删除。
        </p>
      ) : null}
    </section>
  )
}
