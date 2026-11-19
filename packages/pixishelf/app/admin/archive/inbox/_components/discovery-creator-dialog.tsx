'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server'
import { useTRPC } from '@/lib/trpc'
import { CreatorPicker, type CreatorOption } from '@/components/creators/creator-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'

type BindInput = inferRouterInputs<AppRouter>['archiveSearch']['bindCreators']
type Result = inferRouterOutputs<AppRouter>['archiveSearch']['bindCreators']
export interface DiscoveryCreatorDialogState {
  mode: 'defaults' | 'bind' | 'cancel'
  sourceId: string
  itemIds: string[]
  immediateCount: number
  initialCreators: CreatorOption[]
}

export function DiscoveryCreatorDialog({
  state,
  onClose,
  onSaved
}: {
  state: DiscoveryCreatorDialogState
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const trpc = useTRPC()
  const [creators, setCreators] = useState(state.initialCreators.slice(0, 200))
  const [request, setRequest] = useState<BindInput | null>(null)
  const [result, setResult] = useState<Result>(null)
  const [error, setError] = useState<string | null>(null)
  const storageKey = `discovery-creator-request:${state.sourceId}:${state.mode}`
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved) setRequest(JSON.parse(saved) as BindInput)
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
  }, [storageKey])
  const fail = (error: unknown) => setError(archiveClientErrorMessage(error, '操作结果尚未确认，请重试确认原操作。'))
  const defaults = useMutation(
    trpc.archiveSearch.setDefaultCreators.mutationOptions({
      onSuccess: async () => {
        await onSaved()
        onClose()
      },
      onError: fail
    })
  )
  const bind = useMutation(
    trpc.archiveSearch.bindCreators.mutationOptions({
      onSuccess: async (value, variables) => {
        // A recovered request may have different artists from the newly opened selection.
        setCreators(variables.artistIds.map((id) => creators.find((row) => row.id === id) ?? { id, name: String(id) }))
        try {
          sessionStorage.removeItem(storageKey)
        } catch {
          /* Optional recovery storage. */
        }
        setRequest(null)
        setResult(value)
        setError(null)
        await onSaved()
      },
      onError: fail
    })
  )
  const pending = defaults.isPending || bind.isPending
  const submit = (itemIds = state.itemIds) => {
    setError(null)
    if (state.mode === 'defaults') {
      return defaults.mutate({ sourceId: state.sourceId, artistIds: creators.map((row) => row.id) })
    }
    const next = request ?? {
      sourceId: state.sourceId,
      itemIds,
      artistIds: creators.map((row) => row.id).sort((a, b) => a - b),
      requestId: crypto.randomUUID(),
      cancel: state.mode === 'cancel'
    }
    setRequest(next)
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      /* In-memory retry still preserves the request. */
    }
    bind.mutate(next)
  }
  const failed =
    result?.items.filter((row) => row.result === 'FAILED' || row.result === 'CONFLICT').map((row) => row.targetId) ?? []
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state.mode === 'defaults'
              ? '来源固定艺术家'
              : state.mode === 'cancel'
                ? '取消待生效绑定'
                : '批量绑定艺术家'}
          </DialogTitle>
          <DialogDescription>
            {state.mode === 'defaults'
              ? '从本来源加入收件箱时使用这份名单。清空后，下次入箱时需指定本站艺术家。'
              : state.mode === 'cancel'
                ? `已选 ${state.itemIds.length} 个作品。仅取消所选艺术家的待生效绑定；已生效关系请在作品管理中修改。`
                : `为所选 ${state.itemIds.length} 部已归档作品补绑艺术家。已有人补绑的作品会自动跳过。`}
          </DialogDescription>
        </DialogHeader>
        {!result && !request ? (
          <FieldGroup>
            <Field>
              <FieldLabel>艺术家／社团</FieldLabel>
              <CreatorPicker value={creators} onChange={setCreators} />
            </Field>
          </FieldGroup>
        ) : null}
        {request ? (
          <Alert>
            <AlertTitle>有一笔操作等待确认</AlertTitle>
            <AlertDescription>重试会查询并继续原来的 {request.itemIds.length} 项操作，不会重复绑定。</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>操作未完成</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {result ? (
          <div className="flex max-h-72 flex-col gap-2 overflow-auto" aria-live="polite">
            <p>
              {Object.entries({
                [state.mode === 'cancel' ? '已取消' : '已补绑']: result.counts.applied,
                待生效: result.counts.created,
                已跳过: result.counts.skipped,
                未完成: failed.length
              })
                .filter(([, count]) => count > 0)
                .map(([label, count]) => `${label} ${count}`)
                .join(' · ')}
            </p>
            {result.items
              .filter((row) => row.result === 'FAILED' || row.result === 'CONFLICT' || row.result === 'SKIPPED')
              .map((row) => (
                <PrivacySensitiveText key={row.targetId}>{row.message ?? '该项未应用'}</PrivacySensitiveText>
              ))}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {result ? '完成' : '关闭'}
          </Button>
          {result ? (
            failed.length > 0 ? (
              <Button disabled={pending} onClick={() => submit(failed)}>
                重试未完成项（{failed.length}）
              </Button>
            ) : null
          ) : (
            <Button
              disabled={pending || (!request && state.mode !== 'defaults' && creators.length === 0)}
              onClick={() => submit()}
            >
              {pending ? '处理中…' : request ? '确认原操作结果' : '确认保存'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
