'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { LinkIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { AppRouter } from '@/server'
import { useTRPC } from '@/lib/trpc'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupTextarea } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { archiveClientErrorMessage } from './archive-client-error'
import { analyzeArchiveUrlInput } from './archive-intake-view-state'

type RouterOutputs = inferRouterOutputs<AppRouter>
export type ArchiveIntakeCreateResult = RouterOutputs['archiveInbox']['create']

export interface ArchiveAddDialogProps {
  trigger?: ReactNode
  onCreated?: (result: ArchiveIntakeCreateResult) => void
}

export function ArchiveAddDialog({ trigger, onCreated }: ArchiveAddDialogProps) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey)
  const analysis = useMemo(() => analyzeArchiveUrlInput(value), [value])
  const tooMany = analysis.nonEmptyCount > 100
  const createMutation = useMutation(
    trpc.archiveInbox.create.mutationOptions({
      onSuccess: async (result) => {
        toast.success('链接已加入收件箱', {
          description: `新增 ${result.acceptedCount} · 重复 ${result.duplicateCount} · 无效 ${result.invalidCount} · 拒绝 ${result.rejectedCount}`
        })
        setOpen(false)
        setValue('')
        setIdempotencyKey(createIdempotencyKey())
        onCreated?.(result)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.summary.queryKey() })
        ])
      },
      onError: (error) =>
        toast.error('加入收件箱失败', {
          description: archiveClientErrorMessage(error, '链接暂时无法加入，请稍后重试。')
        })
    })
  )

  const updateValue = (nextValue: string) => {
    setValue(nextValue)
    setIdempotencyKey(createIdempotencyKey())
  }

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen && !createMutation.isPending) {
      setValue('')
      setIdempotencyKey(createIdempotencyKey())
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            添加链接
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[min(90vh,48rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>添加到归档收件箱</DialogTitle>
          <DialogDescription>
            每行一个公开 E-Hentai 画廊或图片页链接。提交后即可关闭，解析会按全局队列顺序继续。
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!analysis.nonEmptyCount || tooMany) return
            createMutation.mutate({
              idempotencyKey,
              urls: analysis.lines.map((line) => line.raw)
            })
          }}
        >
          <FieldGroup>
            <Field data-invalid={tooMany || undefined}>
              <FieldLabel htmlFor="archive-intake-urls">作品链接</FieldLabel>
              <InputGroup>
                <InputGroupTextarea
                  id="archive-intake-urls"
                  name="archive-intake-urls"
                  aria-invalid={tooMany || undefined}
                  rows={9}
                  maxLength={204_800}
                  value={value}
                  onChange={(event) => updateValue(event.target.value)}
                  placeholder={'https://e-hentai.org/g/1234567/token/\nhttps://e-hentai.org/s/page-token/1234567-1'}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={createMutation.isPending}
                />
              </InputGroup>
              <FieldDescription>
                客户端只做即时预检；全部非空原行仍交由服务端执行 Provider、SSRF、重复和容量校验。
              </FieldDescription>
              {tooMany ? <FieldError>一次最多添加 100 行，请分次提交。</FieldError> : null}
            </Field>
          </FieldGroup>

          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <Badge variant="outline">非空 {analysis.nonEmptyCount}</Badge>
            <Badge variant={analysis.validCount ? 'success' : 'muted'}>预检有效 {analysis.validCount}</Badge>
            <Badge variant={analysis.invalidCount ? 'warning' : 'muted'}>预检无效 {analysis.invalidCount}</Badge>
            <Badge variant={analysis.duplicateCount ? 'info' : 'muted'}>本次重复 {analysis.duplicateCount}</Badge>
            <Badge variant={tooMany ? 'destructive' : 'muted'}>上限 100</Badge>
          </div>

          {analysis.invalidCount > 0 ? (
            <Alert variant="warning">
              <LinkIcon aria-hidden="true" />
              <AlertTitle>有 {analysis.invalidCount} 行未通过即时预检</AlertTitle>
              <AlertDescription>
                首版支持不含账号凭据的 https://e-hentai.org/g/... 与 /s/...。提交结果以服务端为准。
              </AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => changeOpen(false)}
              disabled={createMutation.isPending}
            >
              取消
            </Button>
            <Button type="submit" disabled={!analysis.nonEmptyCount || tooMany || createMutation.isPending}>
              {createMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {createMutation.isPending ? '正在加入…' : `加入 ${analysis.nonEmptyCount} 行`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function createIdempotencyKey() {
  return `archive-intake:create:${createBrowserUuid()}`
}
