'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { PreferenceItem } from '@/app/settings/_components/preference-item'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useTRPC } from '@/lib/trpc'

export function ArchiveDownloadConcurrencySetting() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const settingsQuery = useQuery(
    trpc.setting.getArchiveDownloadSettings.queryOptions(undefined, { refetchInterval: 5_000 })
  )
  const persisted = settingsQuery.data?.mediaConcurrency ?? 2
  const [selected, setSelected] = useState(persisted)

  useEffect(() => setSelected(persisted), [persisted])

  const mutation = useMutation(
    trpc.setting.updateArchiveDownloadSettings.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData(trpc.setting.getArchiveDownloadSettings.queryKey(), data)
        setSelected(data.mediaConcurrency)
        toast.success('归档下载并发已保存')
      },
      onError: (error) => {
        toast.error(error.message)
        void settingsQuery.refetch()
      }
    })
  )
  const blocked = settingsQuery.data?.canUpdate === false
  const dirty = selected !== persisted
  const disabled = settingsQuery.isLoading || mutation.isPending || blocked

  return (
    <PreferenceItem
      title="归档下载并发"
      description="限制单个归档作品同时拉取的媒体数量；不会提高后台写入任务的全局并发。"
    >
      <FieldGroup className="w-full sm:max-w-xl">
        <Field data-disabled={disabled || undefined}>
          <FieldLabel htmlFor="archive-media-concurrency">同时下载媒体数</FieldLabel>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={String(selected)} onValueChange={(value) => setSelected(Number(value))} disabled={disabled}>
              <SelectTrigger id="archive-media-concurrency" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Array.from({ length: 8 }, (_, index) => index + 1).map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value} 路
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              type="button"
              disabled={disabled || !dirty}
              onClick={() => mutation.mutate({ mediaConcurrency: selected })}
            >
              {mutation.isPending ? <Spinner data-icon="inline-start" /> : null}
              {mutation.isPending ? '保存中' : '保存'}
            </Button>
          </div>
          <FieldDescription>修改只影响之后启动、恢复或重试的归档任务，当前下载不会动态改变。</FieldDescription>
        </Field>

        {blocked ? (
          <Alert>
            <AlertCircleIcon />
            <AlertTitle>正在执行的归档任务锁定了此设置</AlertTitle>
            <AlertDescription>
              请等待任务暂停、取消或结束后再保存。
              {settingsQuery.data?.blockingArchiveImportId ? (
                <Link href={`/admin/archive?taskId=${settingsQuery.data.blockingArchiveImportId}`}>查看阻塞任务</Link>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </FieldGroup>
    </PreferenceItem>
  )
}

