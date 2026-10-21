'use client'

import { useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

export function ArchiveTitleCreatorCleanup({ sourceId, onClose }: { sourceId: string; onClose: () => void }) {
  const trpc = useTRPC()
  const client = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmation, setConfirmation] = useState<{
    pendingIds: string[]
    rulesVersion: number
    requestId: string
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const query = useInfiniteQuery(
    trpc.archiveSearch.creatorCleanupPreview.infiniteQueryOptions(
      { sourceId, limit: 50 },
      { initialCursor: null, getNextPageParam: (page) => page.nextCursor }
    )
  )
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const cleanup = useMutation(
    trpc.archiveSearch.cleanupCreators.mutationOptions({
      onSuccess: async (result) => {
        submitting.current = false
        const failures = result?.items.filter((item) => ['FAILED', 'CONFLICT'].includes(item.result)) ?? []
        if (failures.length) setError(failures.map((item) => item.message).join('；'))
        else toast.success('所选待生效艺术家绑定已取消')
        setSelected(new Set())
        setConfirmation(null)
        await client.invalidateQueries({ queryKey: trpc.archiveSearch.pathKey() })
      },
      onError: (cause) => {
        submitting.current = false
        setError(archiveClientErrorMessage(cause, '取消失败，请重试。'))
      }
    })
  )
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !cleanup.isPending && !confirmation) onClose()
        }}
      >
        <DialogContent
          fitViewport
          className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          <DialogHeader className="shrink-0 border-b p-5 pr-12 text-left">
            <DialogTitle>清理历史待生效绑定</DialogTitle>
            <DialogDescription>只列出已过滤候选上，仍等待追加的来源固定艺术家。不会删除作品或文件。</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-5">
            <Alert>
              <AlertTitle>取消会影响同一画廊的所有入口</AlertTitle>
              <AlertDescription>
                这些艺术家关系跨来源共享。取消后会阻止自动补回；需要恢复时，请显式手动绑定艺术家。已生效关系不在这里修改。
              </AlertDescription>
            </Alert>
            {query.isPending ? <Spinner aria-label="加载待生效绑定" /> : null}
            {items.length ? (
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <Checkbox
                  checked={items.slice(0, 100).every((item) => selected.has(item.id))}
                  onCheckedChange={(checked) =>
                    setSelected(checked ? new Set(items.slice(0, 100).map((item) => item.id)) : new Set())
                  }
                />
                选择已加载的关系，最多 100 条
              </label>
            ) : null}
            {items.map((item) => (
              <label key={item.id} className="flex min-w-0 items-start gap-3 rounded-md border p-3">
                <Checkbox
                  className="mt-1"
                  checked={selected.has(item.id)}
                  disabled={!selected.has(item.id) && selected.size >= 100}
                  onCheckedChange={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (checked && next.size < 100) next.add(item.id)
                      else if (!checked) next.delete(item.id)
                      return next
                    })
                  }
                />
                <div className="min-w-0 text-sm">
                  <PrivacySensitiveText as="p" className="break-words [overflow-wrap:anywhere]">
                    {item.title}
                  </PrivacySensitiveText>
                  <p className="mt-1 text-muted-foreground">
                    待生效：<PrivacySensitiveText>{item.artistName}</PrivacySensitiveText> · #{item.externalId}
                  </p>
                  {item.otherSources > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">同一画廊还出现在 {item.otherSources} 个来源中</p>
                  ) : null}
                </div>
              </label>
            ))}
            {query.isSuccess && !items.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">没有符合条件的待生效绑定。</p>
            ) : null}
            {query.hasNextPage ? (
              <Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                加载更多关系
              </Button>
            ) : null}
            {query.isError ? (
              <Button variant="outline" onClick={() => void query.refetch()}>
                加载失败，重试
              </Button>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>部分关系未取消</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="grid shrink-0 grid-cols-2 gap-2 border-t p-4 sm:flex">
            <Button className="h-11" variant="outline" disabled={cleanup.isPending} onClick={onClose}>
              关闭
            </Button>
            <Button
              className="h-11"
              disabled={!selected.size || cleanup.isPending}
              onClick={() => {
                setError(null)
                setConfirmation({
                  pendingIds: [...selected],
                  rulesVersion: query.data!.pages[0]!.rulesVersion,
                  requestId: crypto.randomUUID()
                })
              }}
            >
              检查并取消 {selected.size} 条
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open && !cleanup.isPending) setConfirmation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消 {confirmation?.pendingIds.length ?? 0} 条待生效关系？</AlertDialogTitle>
            <AlertDialogDescription>
              仅取消刚才勾选的艺术家追加标记。该决定对同一画廊的所有来源生效，不删除作品或文件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleanup.isPending}>返回检查</AlertDialogCancel>
            <AlertDialogAction
              disabled={cleanup.isPending}
              onClick={(event) => {
                event.preventDefault()
                if (confirmation && !submitting.current) {
                  submitting.current = true
                  cleanup.mutate({ sourceId, ...confirmation })
                }
              }}
            >
              {cleanup.isPending ? <Spinner data-icon="inline-start" /> : null}确认取消绑定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
