'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useTRPC } from '@/lib/trpc'

export function ArchiveUploaderCreateSourceDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<void>
}) {
  const trpc = useTRPC()
  const [identityKind, setIdentityKind] = useState<'NAME' | 'UID'>('UID')
  const [identityValue, setIdentityValue] = useState('')
  const createMutation = useMutation(
    trpc.archiveUploader.createSource.mutationOptions({
      onSuccess: async () => {
        toast.success('上传者来源已保存')
        setIdentityValue('')
        onOpenChange(false)
        await onCreated()
      },
      onError: (error) =>
        toast.error('保存来源失败', { description: archiveClientErrorMessage(error, '请检查上传者身份后重试。') })
    })
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            createMutation.mutate({ identityKind, identityValue })
          }}
        >
          <DialogHeader>
            <DialogTitle>新增上传者来源</DialogTitle>
            <DialogDescription>推荐使用数字 UID；名称来源会标记为“未绑定 UID”，之后可原地补录。</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <Field>
              <FieldLabel htmlFor="uploader-identity-kind">身份类型</FieldLabel>
              <Select value={identityKind} onValueChange={(value) => setIdentityKind(value as 'NAME' | 'UID')}>
                <SelectTrigger id="uploader-identity-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="UID">数字 UID（推荐）</SelectItem>
                    <SelectItem value="NAME">上传者名称</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="uploader-identity-value">
                {identityKind === 'UID' ? '上传者 UID' : '上传者名称'}
              </FieldLabel>
              <Input
                id="uploader-identity-value"
                value={identityValue}
                onChange={(event) => setIdentityValue(event.target.value)}
                placeholder={identityKind === 'UID' ? '例如 1234567' : '输入精确上传者名称'}
                inputMode={identityKind === 'UID' ? 'numeric' : 'text'}
                autoComplete="off"
                required
              />
              <FieldDescription>来源只会在你点击扫描按钮后访问 E-Hentai，不会定时自动扫描。</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!identityValue.trim() || createMutation.isPending}>
              {createMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
              保存来源
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
