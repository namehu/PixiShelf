'use client'

import { useEffect, useState } from 'react'
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
import { FieldGroup } from '@/components/ui/field'
import {
  ArchiveUploaderIdentityField,
  useArchiveUploaderIdentity,
  emptyUploaderIdentity,
  type SavedUploaderOption
} from './archive-uploader-identity-field'
import { Spinner } from '@/components/ui/spinner'
import { useTRPC } from '@/lib/trpc'

export function ArchiveUploaderCreateSourceDialog({
  open,
  onOpenChange,
  onCreated,
  sources = []
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (sourceId: string) => Promise<void>
  sources?: SavedUploaderOption[]
}) {
  const trpc = useTRPC()
  const identity = useArchiveUploaderIdentity(open)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (open) identity.change(emptyUploaderIdentity)
  }, [open, identity.change])
  const createMutation = useMutation(
    trpc.archiveUploader.createSource.mutationOptions({
      onSuccess: async (source) => {
        toast.success(source.reused ? '该上传者已存在，已打开原来源' : '上传者来源已保存', {
          description:
            source.status === 'ARCHIVED'
              ? '该来源已停用，可在详情中重新启用。'
              : !source.uploaderUid
                ? '当前按名称搜索，后续扫描会继续尝试识别账号。'
                : undefined
        })
        onOpenChange(false)
        await onCreated(source.id)
      },
      onError: (error) =>
        toast.error('保存来源失败', { description: archiveClientErrorMessage(error, '请检查上传者身份后重试。') })
    })
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!saving && !createMutation.isPending) onOpenChange(value)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setSaving(true)
            try {
              const chosen = await identity.getIdentity()
              if (!chosen) return
              await createMutation.mutateAsync({
                identityKind: chosen.mode,
                identityValue: chosen.value,
                ...(chosen.resolvedUid ? { uploaderUid: chosen.resolvedUid } : {}),
                ...(chosen.displayName ? { displayName: chosen.displayName } : {})
              })
            } catch {
              // Identity validation is inline; mutation errors use the existing toast.
            } finally {
              setSaving(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>新增上传者来源</DialogTitle>
            <DialogDescription>
              输入原站上的完整上传者名称，系统自动识别账号。保存后由你手动启动扫描。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-5">
            <ArchiveUploaderIdentityField
              identity={identity}
              sources={sources}
              disabled={saving || createMutation.isPending}
            />
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving || createMutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={!identity.draft.value.trim() || saving || createMutation.isPending}>
              {saving || createMutation.isPending ? <Spinner data-icon="inline-start" /> : null}
              {saving && identity.pending ? '识别并保存中' : '保存来源'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
