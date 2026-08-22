'use client'

import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import type { SourceAuditSelectionCounts } from './source-audit-view-state'

export function SourceAuditApplyDialog({
  open,
  counts,
  pending,
  error,
  onOpenChange,
  onConfirm
}: {
  open: boolean
  counts: SourceAuditSelectionCounts
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>同步所选的 {counts.total} 项来源？</AlertDialogTitle>
          <AlertDialogDescription>
            Worker 会逐项重新核验来源，再导入新增作品或同步已有作品的来源内容。这个操作不会删除“来源缺失”项目。
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap gap-2" aria-label="所选同步项目摘要">
            {counts.new > 0 ? <Badge variant="info">新增导入 {counts.new}</Badge> : null}
            {counts.changed > 0 ? <Badge variant="warning">变化同步 {counts.changed}</Badge> : null}
          </div>
          <p className="leading-6 text-muted-foreground">
            PixiShelf
            会保留本地标签、人工编辑和其他来源信息。若来源或图库在核对后发生变化，对应项目会安全跳过或标记冲突，其他项目仍可继续完成。
          </p>
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>暂时无法开始同步</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>返回检查</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || counts.total === 0}
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {pending ? '正在提交…' : '确认同步'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
