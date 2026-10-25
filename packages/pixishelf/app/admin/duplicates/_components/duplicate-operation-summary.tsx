import type { ArtworkDedupOperationDto } from '@pixishelf/job-contracts'
import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  duplicateBytes,
  duplicateDiagnosticCode,
  duplicateOperationLabels,
  isDirectDeletePreview
} from './duplicate-operation-state'

export function DuplicateOperationSummary({ operation }: { operation: ArtworkDedupOperationDto }) {
  const { counts, status } = operation
  const completed = status === 'DELETED'
  const deleting = isDirectDeletePreview(operation) && operation.mode === 'DIRECT_DELETE'
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
      {completed ? (
        <CircleCheck className="mt-1.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      ) : operation.failure || counts.blockedGroups > 0 ? (
        <CircleAlert className="mt-1.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      ) : null}
      <div className="min-w-0 flex-1 space-y-1 py-1">
        {status !== 'READY' ? <p className="text-sm font-medium">{duplicateOperationLabels[status]}</p> : null}
        <p role="status" aria-live="polite" className="text-sm leading-5">
          {completed
            ? `已删除 ${counts.completedCopies} 部重复作品，保留 ${counts.keepers} 部。`
            : deleting
              ? `已删除 ${counts.completedCopies} 部，尚有 ${counts.remainingCopies} 部未完成。`
              : `保留 ${counts.keepers} 部，删除 ${counts.copies} 部重复作品。`}
        </p>
        {status === 'BUILDING' ? (
          <p className="text-xs text-muted-foreground">正在检查文件，完成后可确认删除。</p>
        ) : null}
        {deleting && !completed ? (
          <p className="text-xs text-muted-foreground">
            {operation.deleteStartedAt
              ? '已删除的文件无法恢复。'
              : status === 'CANCELLED'
                ? '已取消，未删除文件。'
                : '尚未删除文件，正在核对作品。'}
          </p>
        ) : null}
        {counts.excludedGroups > 0 || counts.blockedGroups > 0 ? (
          <p className="text-xs text-muted-foreground">
            {counts.excludedGroups} 组未选入，{counts.blockedGroups} 组无法处理。
          </p>
        ) : null}
      </div>
      <DuplicateOperationDiagnostics operation={operation} />
    </div>
  )
}

export function DuplicateOperationDiagnostics({ operation }: { operation: ArtworkDedupOperationDto }) {
  const { counts, status } = operation
  const completed = status === 'DELETED'
  const deleting = isDirectDeletePreview(operation) && operation.mode === 'DIRECT_DELETE'
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label="处理详情">
          <Info className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="处理详情"
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] text-xs text-muted-foreground"
      >
        <p className="mb-3 text-sm font-medium text-foreground">处理详情</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 pb-2">
          <dt>重复组</dt>
          <dd>{counts.selectedGroups} 组</dd>
          <dt>检查文件</dt>
          <dd>{BigInt(counts.preparedFiles).toLocaleString()} 个</dd>
          <dt>删除文件总大小</dt>
          <dd>{duplicateBytes(counts.logicalBytes)}</dd>
          {deleting ? (
            <>
              <dt>已删除文件</dt>
              <dd>{BigInt(counts.deletedFiles).toLocaleString()} 个</dd>
            </>
          ) : null}
          {deleting && !completed ? (
            <>
              <dt>尚未确认删除</dt>
              <dd>{BigInt(counts.remainingFiles).toLocaleString()} 个</dd>
            </>
          ) : null}
          {operation.validatedAt ? (
            <>
              <dt>上次核对</dt>
              <dd>{new Date(operation.validatedAt).toLocaleString('zh-CN')}</dd>
            </>
          ) : null}
        </dl>
        {deleting && !completed && operation.deleteStartedAt ? (
          <p>部分文件的删除结果可能尚未确认，请以重新核对后的结果为准。</p>
        ) : null}
        {operation.failure ? (
          <p className="mt-2 font-mono break-all">{duplicateDiagnosticCode(operation.failure.code)}</p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
