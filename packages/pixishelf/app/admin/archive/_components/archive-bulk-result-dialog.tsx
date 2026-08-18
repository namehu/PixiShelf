'use client'

import type { inferRouterOutputs } from '@trpc/server'
import { CheckCircle2Icon, ListChecksIcon } from 'lucide-react'
import type { AppRouter } from '@/server'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type RouterOutputs = inferRouterOutputs<AppRouter>
export type ArchiveBulkOperationView = NonNullable<RouterOutputs['archive']['getBulkOperation']>

export interface ArchiveBulkResultDialogProps {
  operation: ArchiveBulkOperationView | null
  onOpenChange: (open: boolean) => void
}

const resultLabel = {
  CREATED: '已创建',
  APPLIED: '已执行',
  REUSED: '已复用',
  SKIPPED: '已跳过',
  CONFLICT: '冲突',
  FAILED: '失败'
} as const

export function ArchiveBulkResultDialog({ operation, onOpenChange }: ArchiveBulkResultDialogProps) {
  return (
    <Dialog open={Boolean(operation)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>批量操作结果</DialogTitle>
          <DialogDescription>
            {operation
              ? `${commandLabel(operation.commandType)}已处理 ${operation.items.length}/${operation.requestedCount} 项，逐项结果已持久保存。`
              : '逐项结果由持久操作记录提供。'}
          </DialogDescription>
        </DialogHeader>

        {operation ? (
          <div className="flex min-h-0 flex-col gap-4">
            <div className="flex flex-wrap gap-2" aria-label="批量结果摘要">
              <Badge variant="success">成功 {operation.counts.created + operation.counts.applied}</Badge>
              <Badge variant="info">复用 {operation.counts.reused}</Badge>
              <Badge variant="muted">跳过 {operation.counts.skipped}</Badge>
              <Badge variant="warning">冲突 {operation.counts.conflict}</Badge>
              <Badge variant="destructive">失败 {operation.counts.failed}</Badge>
            </div>

            {operation.items.length ? (
              <div className="max-h-[55vh] overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>目标</TableHead>
                      <TableHead>结果</TableHead>
                      <TableHead>说明</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {operation.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs tabular-nums">…{item.targetId.slice(-10)}</TableCell>
                        <TableCell>
                          <ResultBadge result={item.result} />
                        </TableCell>
                        <TableCell className="max-w-md whitespace-normal text-muted-foreground">
                          {item.message || item.code || '操作已完成'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ListChecksIcon aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>还没有逐项结果</EmptyTitle>
                  <EmptyDescription>操作仍在恢复或处理时，可稍后重新查看持久操作记录。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            <CheckCircle2Icon data-icon="inline-start" aria-hidden="true" />
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResultBadge({ result }: { result: keyof typeof resultLabel }) {
  const variant =
    result === 'FAILED'
      ? 'destructive'
      : result === 'CONFLICT'
        ? 'warning'
        : result === 'SKIPPED'
          ? 'muted'
          : result === 'REUSED'
            ? 'info'
            : 'success'
  return <Badge variant={variant}>{resultLabel[result]}</Badge>
}

function commandLabel(command: ArchiveBulkOperationView['commandType']) {
  return (
    {
      ENQUEUE: '归档入队',
      PAUSE: '暂停',
      RESUME: '继续',
      CANCEL: '取消',
      RETRY: '重试'
    } as const
  )[command]
}
