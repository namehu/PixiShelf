'use client'

import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { Button, buttonVariants } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
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
import { ArchiveBulkResultDialog, type ArchiveBulkOperationView } from '../../_components/archive-bulk-result-dialog'
import { archiveClientErrorMessage } from '../../_components/archive-client-error'
import { getOrCreateArchiveCommandKey, releaseArchiveCommandKey } from '../../_components/archive-intake-view-state'

const ResultContext = createContext<((operation: ArchiveBulkOperationView) => void) | null>(null)

/** Keep operation results visible even when refreshed lists unmount the deleted rows. */
export function ArchiveDeleteFailedResultProvider({ children }: { children: ReactNode }) {
  const [operation, setOperation] = useState<ArchiveBulkOperationView | null>(null)
  return (
    <ResultContext.Provider value={setOperation}>
      {children}
      <ArchiveBulkResultDialog
        operation={operation}
        onOpenChange={(open) => {
          if (!open) setOperation(null)
        }}
      />
    </ResultContext.Provider>
  )
}

export function ArchiveDeleteFailedDialog({
  itemIds,
  targetType,
  disabled = false,
  onDeleted
}: {
  itemIds: string[]
  targetType: 'INTAKE_ITEM' | 'DISCOVERY_ITEM'
  disabled?: boolean
  onDeleted?: () => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const keys = useRef(new Map<string, string>())
  const [targets, setTargets] = useState<string[] | null>(null)
  const [operation, setOperation] = useState<ArchiveBulkOperationView | null>(null)
  const publishResult = useContext(ResultContext) ?? setOperation
  const mutation = useMutation(
    trpc.archiveInbox.deleteFailedMany.mutationOptions({
      onSuccess: async (result, variables) => {
        if (!result) {
          toast.error('删除结果暂不可用，请重试查询')
          return
        }
        releaseArchiveCommandKey(keys.current, 'DELETE_FAILED_RECORDS', { targetType, itemIds: variables.itemIds })
        setTargets(null)
        publishResult(result)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.summary.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.pathKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.archiveUploader.pathKey() })
        ])
        onDeleted?.()
      },
      onError: (error) =>
        toast.error('删除失败', {
          description: archiveClientErrorMessage(error, '请求结果未确认，请重试；不会重复删除。')
        })
    })
  )
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || mutation.isPending || itemIds.length === 0}
        onClick={() => setTargets([...itemIds].sort())}
      >
        <Trash2Icon data-icon="inline-start" aria-hidden="true" />
        删除失败记录{itemIds.length > 1 ? `（${itemIds.length}）` : ''}
      </Button>
      <AlertDialog
        open={targets !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setTargets(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除失败收件及发现记录？</AlertDialogTitle>
            <AlertDialogDescription>
              将处理选中的 {targets?.length ?? 0}{' '}
              项，同时删除同作品的全部失败收件、各来源发现记录及扫描明细，实际删除条数可能更多。
              本地作品、图片和下载任务不受影响，执行日志保留。删除无法撤销；以后原站再次返回该作品时仍可重新发现。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              disabled={mutation.isPending}
              onClick={(event) => {
                event.preventDefault()
                if (!targets) return
                const payload = { targetType, itemIds: targets }
                mutation.mutate({
                  ...payload,
                  idempotencyKey: getOrCreateArchiveCommandKey(
                    keys.current,
                    'DELETE_FAILED_RECORDS',
                    payload,
                    () => `archive-delete:${createBrowserUuid()}`
                  )
                })
              }}
            >
              {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ArchiveBulkResultDialog
        operation={operation}
        onOpenChange={(open) => {
          if (!open) setOperation(null)
        }}
      />
    </>
  )
}
