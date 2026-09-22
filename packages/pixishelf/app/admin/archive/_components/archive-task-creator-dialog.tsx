'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { inferRouterInputs } from '@trpc/server'
import type { AppRouter } from '@/server'
import { useTRPC } from '@/lib/trpc'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { CreatorPicker, type CreatorOption } from '@/components/creators/creator-picker'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { archiveClientErrorMessage } from './archive-client-error'
import type { ArchiveCreatorTask } from './archive-task-creators'

type EditInput = inferRouterInputs<AppRouter>['archive']['editTaskCreators']

export function ArchiveTaskCreatorDialog({
  taskId,
  onClose,
  onUpdated
}: {
  taskId: string
  onClose: () => void
  onUpdated: (task: ArchiveCreatorTask) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [creators, setCreators] = useState<CreatorOption[]>([])
  const [removing, setRemoving] = useState<CreatorOption | null>(null)
  const [request, setRequest] = useState<EditInput | null>(null)
  const [failedRequest, setFailedRequest] = useState<EditInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const inFlight = useRef(false)
  const storageKey = `archive-task-creators:${taskId}`
  const query = useQuery(trpc.archive.listTasks.queryOptions({ taskId, limit: 1 }))
  const task = query.data?.items[0]
  useEffect(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as EditInput | null
      if (
        value?.taskId === taskId &&
        ['ADD', 'REMOVE'].includes(value.action) &&
        typeof value.requestId === 'string' &&
        Array.isArray(value.artistIds) &&
        value.artistIds.length > 0 &&
        value.artistIds.length <= 200 &&
        value.artistIds.every((id) => Number.isInteger(id) && id > 0)
      ) {
        setRequest(value)
      }
    } catch {
      /* Recovery storage is optional in private browsing. */
    }
  }, [storageKey, taskId])

  const mutation = useMutation(
    trpc.archive.editTaskCreators.mutationOptions({
      onSuccess: async (result, variables) => {
        const outcome = result?.items[0]
        if (!outcome) {
          setError('操作结果尚未确认，请重试确认原操作。')
          return
        }
        setRequest(null)
        try {
          sessionStorage.removeItem(storageKey)
        } catch {
          /* In-memory recovery remains available. */
        }
        if (!['APPLIED', 'CREATED', 'REUSED'].includes(outcome.result)) {
          setFailedRequest(variables)
          setError(outcome.message ?? '保存未完成，请重试。')
          return
        }
        setError(null)
        setFailedRequest(null)
        setRemoving(null)
        if (variables.action === 'ADD') setCreators([])
        setNotice(
          variables.action === 'REMOVE'
            ? '已移除绑定'
            : outcome.result === 'CREATED'
              ? '已保存，归档后生效'
              : '已绑定艺术家'
        )
        // The receipt is already confirmed; refresh failures must not turn it into an unknown write.
        const refreshed = await query.refetch()
        if (refreshed.data?.items[0]) onUpdated(refreshed.data.items[0])
        await Promise.allSettled([
          queryClient.invalidateQueries({ queryKey: trpc.archive.listTasks.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.archiveSearch.pathKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.archiveUploader.pathKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.artwork.pathKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.artist.pathKey() })
        ])
      },
      onError: (value) => setError(archiveClientErrorMessage(value, '操作结果尚未确认，请重试确认原操作。')),
      onSettled: () => {
        inFlight.current = false
      }
    })
  )
  const submit = (action: EditInput['action'], artistIds: number[]) => {
    if (inFlight.current) return
    const next = request ?? {
      taskId,
      action,
      artistIds: [...new Set(artistIds)].sort((a, b) => a - b),
      requestId: createBrowserUuid()
    }
    inFlight.current = true
    setRequest(next)
    setError(null)
    setNotice(null)
    setFailedRequest(null)
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      /* Retry retains the request in memory. */
    }
    mutation.mutate(next)
  }
  const blocked = mutation.isPending || Boolean(request) || !task || Boolean(task.creatorEditBlockedReason)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>管理艺术家</DialogTitle>
          <DialogDescription>
            修改对同一原站作品的所有任务与来源生效。未归档的绑定会在归档后生效，不会启动下载。
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <p role="status">正在读取绑定…</p>
        ) : query.isError ? (
          <div>
            <p role="alert">读取绑定失败</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              重新加载
            </Button>
          </div>
        ) : !task ? (
          <p role="alert">归档任务不存在</p>
        ) : (
          <>
            <PrivacySensitiveText className="break-words">{task.title ?? task.externalId}</PrivacySensitiveText>
            {task.creatorEditBlockedReason && (
              <p role="alert" className="text-sm text-muted-foreground">
                {task.creatorEditBlockedReason}
              </p>
            )}
            {(['effectiveCreators', 'pendingCreators'] as const).map((key) => (
              <section
                key={key}
                className="flex flex-col gap-2"
                aria-label={key === 'effectiveCreators' ? '已绑定' : '待生效'}
              >
                <h3 className="text-sm font-medium">{key === 'effectiveCreators' ? '已绑定' : '待生效'}</h3>
                {!task[key]?.length && <p className="text-sm text-muted-foreground">暂无</p>}
                {(task[key] ?? []).map((creator) => (
                  <div key={creator.id} className="flex items-center justify-between gap-2">
                    <PrivacySensitiveText className="min-w-0 break-words">
                      {creator.kind === 'GROUP' ? '社团：' : ''}
                      {creator.name}
                    </PrivacySensitiveText>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={blocked}
                      onClick={() => {
                        setRemoving(creator)
                        setFailedRequest(null)
                      }}
                    >
                      移除
                    </Button>
                  </div>
                ))}
              </section>
            ))}
            {!task.effectiveCreators?.length && !task.pendingCreators?.length && (
              <p className="text-sm text-muted-foreground">未绑定艺术家</p>
            )}
            {removing && !request && (
              <Alert>
                <AlertTitle>确认移除这位艺术家？</AlertTitle>
                <AlertDescription>
                  <PrivacySensitiveText>{removing.name}</PrivacySensitiveText>
                  <p>移除后，来源扫描不会自动补回；以后仍可手动重新绑定。</p>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={blocked}
                      onClick={() => submit('REMOVE', [removing.id])}
                    >
                      确认移除
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setRemoving(null)}>
                      取消
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}
            {!blocked && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">追加艺术家／社团</p>
                <CreatorPicker value={creators} onChange={setCreators} />
                <Button
                  className="self-start"
                  disabled={!creators.length}
                  onClick={() =>
                    submit(
                      'ADD',
                      creators.map((row) => row.id)
                    )
                  }
                >
                  追加所选艺术家
                </Button>
              </div>
            )}
          </>
        )}
        {request && (
          <Alert>
            <AlertTitle>有一笔操作等待确认</AlertTitle>
            <AlertDescription>
              重试会继续原来的{request.action === 'ADD' ? '追加' : '移除'}操作，不会重复修改。
            </AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>操作未完成</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={mutation.isPending} onClick={onClose}>
            关闭
          </Button>
          {request && (
            <Button disabled={mutation.isPending} onClick={() => submit(request.action, request.artistIds)}>
              {mutation.isPending ? '处理中…' : '确认原操作结果'}
            </Button>
          )}
          {failedRequest && !request && (
            <Button disabled={blocked} onClick={() => submit(failedRequest.action, failedRequest.artistIds)}>
              重试未完成操作
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
