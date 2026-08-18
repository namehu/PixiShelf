'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LinkIcon, RotateCcwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useTRPC } from '@/lib/trpc'
import { archiveClientErrorMessage } from './archive-client-error'
import {
  analyzeArchiveUrlInput,
  archiveReplacementNotice,
  getOrCreateArchiveCommandKey,
  releaseArchiveCommandKey
} from './archive-intake-view-state'

export function ArchiveReplaceDialog({
  itemId,
  open,
  onOpenChange,
  onCreated
}: {
  itemId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void | Promise<unknown>
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const commandKeys = useRef(new Map<string, string>())
  const [value, setValue] = useState('')
  const analysis = useMemo(() => analyzeArchiveUrlInput(value), [value])
  const valid = analysis.nonEmptyCount === 1 && analysis.validCount === 1

  useEffect(() => {
    setValue('')
  }, [itemId])

  const replaceMutation = useMutation(
    trpc.archiveInbox.replace.mutationOptions({
      onSuccess: async (result, variables) => {
        releaseArchiveCommandKey(commandKeys.current, 'REPLACE', {
          itemId: variables.itemId,
          url: variables.url
        })
        const notice = archiveReplacementNotice(result)
        toast[notice.tone](notice.title, { description: notice.description })
        setValue('')
        onOpenChange(false)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.summary.queryKey() }),
          onCreated()
        ])
      },
      onError: (error) =>
        toast.error('修改并重试失败', {
          description: archiveClientErrorMessage(error, '修正链接暂时无法加入队尾，请稍后重试。')
        })
    })
  )

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !replaceMutation.isPending && onOpenChange(nextOpen)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>修改链接并重试</DialogTitle>
          <DialogDescription>
            输入修正后的公开链接。系统会创建一个关联的新收件项目，原失败记录不会被改写。
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            const url = value.trim()
            if (!itemId || !valid || replaceMutation.isPending) return
            const payload = { itemId, url }
            replaceMutation.mutate({
              ...payload,
              idempotencyKey: getOrCreateArchiveCommandKey(
                commandKeys.current,
                'REPLACE',
                payload,
                () => `archive-intake:replace:${crypto.randomUUID()}`
              )
            })
          }}
        >
          <Field data-invalid={(value.length > 0 && !valid) || undefined}>
            <FieldLabel htmlFor="archive-intake-replacement-url">修正后的作品链接</FieldLabel>
            <Input
              id="archive-intake-replacement-url"
              name="archive-intake-replacement-url"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              maxLength={2_048}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="https://e-hentai.org/g/1234567/token/…"
              disabled={replaceMutation.isPending}
              aria-invalid={(value.length > 0 && !valid) || undefined}
            />
            {value.length > 0 && !valid ? (
              <FieldError>请输入一个受支持、且不含账号凭据的 HTTPS 归档链接。</FieldError>
            ) : null}
          </Field>

          <Alert variant="info">
            <LinkIcon aria-hidden="true" />
            <AlertTitle>保留原始审计记录</AlertTitle>
            <AlertDescription>新项目会排到解析队尾，并可从原失败项目追溯修正关系。</AlertDescription>
          </Alert>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={replaceMutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={!itemId || !valid || replaceMutation.isPending}>
              {replaceMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {replaceMutation.isPending ? '正在加入…' : '创建修正项目'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
