'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PreferenceItem } from '@/app/settings/_components/preference-item'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useTRPC } from '@/lib/trpc'

export function ArchiveEhCookieSetting() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [cookie, setCookie] = useState('')
  const statusQuery = useQuery(trpc.setting.getArchiveEhCookieStatus.queryOptions())
  const onSuccess = (data: NonNullable<typeof statusQuery.data>) => {
    queryClient.setQueryData(trpc.setting.getArchiveEhCookieStatus.queryKey(), data)
    setCookie('')
    toast.success('共享 EH Cookie 已更新')
  }
  const save = useMutation(
    trpc.setting.saveArchiveEhCookie.mutationOptions({
      onSuccess,
      onError: (error) => toast.error(error.message)
    })
  )
  const clear = useMutation(
    trpc.setting.clearArchiveEhCookie.mutationOptions({
      onSuccess,
      onError: (error) => toast.error(error.message)
    })
  )
  const status = statusQuery.data
  const busy = save.isPending || clear.isPending

  return (
    <PreferenceItem title="共享 EH Cookie" description="供后台 EH 原图下载使用。所有管理员共用，保存后只显示配置状态。">
      <FieldGroup className="w-full sm:max-w-xl">
        <Field data-disabled={busy || undefined}>
          <FieldLabel htmlFor="archive-eh-cookie">更新 Cookie</FieldLabel>
          <Input
            id="archive-eh-cookie"
            type="password"
            autoComplete="off"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
            disabled={busy || !status?.encryptionAvailable}
            placeholder="粘贴 Cookie 请求头的值"
          />
          <FieldDescription>
            {!status?.encryptionAvailable
              ? '部署尚未配置 Cookie 加密密钥，请先为 App 和 Worker 设置相同的独立密钥。'
              : status.configured && !status.readable
                ? '已保存的 Cookie 无法解密，请检查密钥或重新保存。'
                : status.configured
                  ? '已配置。有效性和原图额度将在下载时校验，失效时任务暂停。'
                  : '未配置。需要登录的原图下载会暂停。'}
          </FieldDescription>
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={busy || !cookie.trim() || !status?.encryptionAvailable}
            onClick={() => save.mutate({ cookie })}
          >
            {save.isPending ? '保存中…' : '保存 Cookie'}
          </Button>
          <Button type="button" variant="outline" disabled={busy || !status?.configured} onClick={() => clear.mutate()}>
            {clear.isPending ? '清除中…' : '清除 Cookie'}
          </Button>
        </div>
      </FieldGroup>
    </PreferenceItem>
  )
}
