'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server'
import type { CreatorOption } from '@/components/creators/creator-picker'
import { useTRPC } from '@/lib/trpc'
import { archiveDiscoverySourceHref } from '@/lib/archive-source-links'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { FieldError } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'
import Link from 'next/link'
import { toast } from 'sonner'

export interface ExistingSourceCreators {
  source: inferRouterOutputs<AppRouter>['archiveSearch']['createSource']
  creators: CreatorOption[]
}

export function ArchiveExistingSourceCreators({
  source,
  creators,
  onBack,
  onClose,
  onSaved,
  onPendingChange
}: ExistingSourceCreators & {
  onBack: () => void
  onClose: () => void
  onSaved: (sourceId: string) => Promise<void>
  onPendingChange?: (pending: boolean) => void
}) {
  const trpc = useTRPC()
  const [error, setError] = useState<string | null>(null)
  const append = useMutation(
    trpc.archiveSearch.appendDefaultCreators.mutationOptions({
      onSuccess: async () => {
        toast.success('已追加绑定，原有艺术家已保留')
        onClose()
        try {
          await onSaved(source.id)
        } catch {
          toast.error('绑定已保存，列表刷新失败，请刷新页面查看。')
        }
      },
      onError: (cause) =>
        setError(
          cause.data?.code === 'PRECONDITION_FAILED'
            ? '来源或艺术家状态已变化，请返回修改条件并重新保存确认。'
            : archiveClientErrorMessage(cause, '追加绑定失败，请重试。')
        )
    })
  )
  useEffect(() => {
    onPendingChange?.(append.isPending)
  }, [append.isPending, onPendingChange])
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
        <Alert>
          <AlertTitle>相同条件的来源已存在</AlertTitle>
          <AlertDescription>
            <PrivacySensitiveText>{source.displayName}</PrivacySensitiveText>
            <p>
              {source.status === 'ARCHIVED'
                ? '该来源已停用，追加绑定不会自动启用。'
                : '确认后将追加以下艺术家，保留原有绑定。'}
            </p>
          </AlertDescription>
        </Alert>
        <div className="grid gap-2">
          <p className="text-sm font-medium">已有绑定</p>
          {source.defaultCreators.length ? (
            <ul className="grid gap-1 text-sm">
              {source.defaultCreators.map((creator) => (
                <li key={creator.id}>
                  <PrivacySensitiveText>{creator.name}</PrivacySensitiveText>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">未关联</p>
          )}
          <p className="text-sm font-medium">待追加绑定</p>
          <ul className="grid gap-1 text-sm">
            {creators.map((creator) => (
              <li key={creator.id}>
                <PrivacySensitiveText>{creator.name}</PrivacySensitiveText>
              </li>
            ))}
          </ul>
        </div>
        {error ? <FieldError role="alert">{error}</FieldError> : null}
        <Button asChild variant="link" disabled={append.isPending}>
          <Link
            href={archiveDiscoverySourceHref(source.id)}
            onClick={(event) => {
              if (append.isPending) event.preventDefault()
            }}
          >
            查看已有来源
          </Link>
        </Button>
      </div>
      <DialogFooter className="flex shrink-0 flex-wrap gap-2 border-t px-5 py-4">
        <Button type="button" variant="outline" disabled={append.isPending} onClick={onClose}>
          取消
        </Button>
        <Button type="button" variant="outline" disabled={append.isPending} onClick={onBack}>
          返回修改条件
        </Button>
        <Button
          type="button"
          disabled={append.isPending}
          onClick={() => {
            setError(null)
            append.mutate({
              sourceId: source.id,
              artistIds: creators.map(({ id }) => id),
              expectedRulesVersion: source.rulesVersion
            })
          }}
        >
          {append.isPending ? <Spinner data-icon="inline-start" /> : null}追加绑定
        </Button>
      </DialogFooter>
    </>
  )
}
