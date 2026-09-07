'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CircleStopIcon, Trash2Icon } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { scanRunStatusLabel } from './archive-uploader-view-state'

export function ArchiveDiscoveryDeleteDialog({
  sourceId,
  onClose,
  onDeleted
}: {
  sourceId: string
  onClose: () => void
  onDeleted: (sourceId: string) => Promise<void>
}) {
  const trpc = useTRPC()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [cancelRequestedRunId, setCancelRequestedRunId] = useState<string | null>(null)
  const previewQuery = useQuery(
    trpc.archiveSearch.getDeletePreview.queryOptions(
      { sourceId },
      { refetchOnMount: 'always', refetchInterval: (query) => (query.state.data?.blockingRun ? 3_000 : false) }
    )
  )
  const preview = previewQuery.data
  const blockingRun = preview?.blockingRun
  const cancelMutation = useMutation(
    trpc.archiveSearch.cancelScan.mutationOptions({
      onSuccess: async (result) => {
        setCancelRequestedRunId(result.id)
        await previewQuery.refetch()
      },
      onError: async (error) => {
        setErrorMessage(archiveClientErrorMessage(error, '取消扫描失败，请刷新状态后重试。'))
        await previewQuery.refetch()
      }
    })
  )
  const deleteMutation = useMutation(
    trpc.archiveSearch.deleteSource.mutationOptions({
      onSuccess: async () => {
        await onDeleted(sourceId)
        onClose()
      },
      onError: async (error) => {
        setErrorMessage(archiveClientErrorMessage(error, '删除来源失败，请重试。'))
        await previewQuery.refetch()
      }
    })
  )
  const busy = cancelMutation.isPending || deleteMutation.isPending
  const cancelling = Boolean(
    blockingRun && (blockingRun.systemJob.status === 'CANCELLING' || cancelRequestedRunId === blockingRun.id)
  )

  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除发现来源</AlertDialogTitle>
          <AlertDialogDescription>
            删除后，该来源及其扫描进度、发现历史将永久移除。已加入收件箱的项目、归档任务和本地作品会保留。
            重新新增相同来源将从头扫描。全局忽略记录继续保留。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {previewQuery.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : previewQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>无法读取删除范围</AlertTitle>
            <AlertDescription>请重新加载后再确认，当前没有删除任何内容。</AlertDescription>
          </Alert>
        ) : preview ? (
          <div className="flex flex-col gap-3">
            <PrivacySensitiveText className="break-all font-medium">{preview.displayName}</PrivacySensitiveText>
            <p className="text-sm text-muted-foreground">
              将删除 {preview.scanRunCount} 条扫描记录和 {preview.catalogItemCount} 条发现结果。
            </p>
            {blockingRun ? (
              <Alert>
                <AlertTitle>{cancelling ? '正在取消扫描' : '请先结束扫描'}</AlertTitle>
                <AlertDescription>
                  {cancelling ? '等待后台安全结束。' : `当前扫描：${scanRunStatusLabel(blockingRun.status)}。`}
                  扫描结束后仍需点击“确认删除”，不会自动删除来源。
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">该来源已经删除，请关闭并刷新列表。</p>
        )}
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>操作未完成</AlertTitle>
            <AlertDescription>
              <PrivacySensitiveText>{errorMessage}</PrivacySensitiveText>
            </AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            返回
          </Button>
          {previewQuery.isError ? (
            <Button variant="outline" onClick={() => void previewQuery.refetch()} disabled={previewQuery.isFetching}>
              重新加载
            </Button>
          ) : preview === null ? (
            <Button
              onClick={async () => {
                await onDeleted(sourceId)
                onClose()
              }}
            >
              关闭并刷新
            </Button>
          ) : (
            <>
              {blockingRun ? (
                <Button
                  variant="outline"
                  disabled={busy || cancelling}
                  onClick={() => {
                    setErrorMessage(null)
                    cancelMutation.mutate({ sourceId, runId: blockingRun.id })
                  }}
                >
                  {busy || cancelling ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <CircleStopIcon data-icon="inline-start" />
                  )}
                  {cancelling ? '正在取消' : '取消扫描'}
                </Button>
              ) : null}
              <Button
                variant="destructive"
                disabled={busy || !preview || Boolean(blockingRun) || previewQuery.isFetching}
                onClick={() => {
                  setErrorMessage(null)
                  deleteMutation.mutate({ sourceId })
                }}
              >
                {deleteMutation.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Trash2Icon data-icon="inline-start" />
                )}
                {deleteMutation.isPending ? '正在删除' : '确认删除'}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
