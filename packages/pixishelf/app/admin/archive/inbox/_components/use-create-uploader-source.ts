'use client'

import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'
import { useTRPC } from '@/lib/trpc'
import { useArchiveUploaderIdentity, emptyUploaderIdentity } from './archive-uploader-identity-field'

export function useCreateUploaderSource({
  open,
  onOpenChange,
  onCreated,
  artistIds
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (sourceId: string) => Promise<void>
  artistIds: number[]
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

  const submit = async () => {
    setSaving(true)
    try {
      const chosen = await identity.getIdentity()
      if (!chosen) return
      await createMutation.mutateAsync({
        ...(artistIds.length ? { artistIds } : {}),
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
  }
  return { identity, pending: saving || createMutation.isPending, saving, submit }
}
