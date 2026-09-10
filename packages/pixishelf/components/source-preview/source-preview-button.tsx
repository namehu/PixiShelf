'use client'

import { useMutation } from '@tanstack/react-query'
import { ImagesIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ComponentProps, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useTRPC } from '@/lib/trpc'
import type { ArchivePreviewSourceInput, OpenArchivePreviewDto } from '@/services/archive-preview/archive-preview-types'

export interface SourcePreviewButtonProps extends Omit<ComponentProps<typeof Button>, 'children' | 'onClick' | 'type'> {
  source: ArchivePreviewSourceInput
  children?: ReactNode
  onOpened?: (result: OpenArchivePreviewDto) => void
  navigate?: boolean
}

export function SourcePreviewButton({
  source,
  children = '原站预览',
  disabled,
  onOpened,
  navigate = true,
  ...buttonProps
}: SourcePreviewButtonProps) {
  const trpc = useTRPC()
  const router = useRouter()
  const openPreview = useMutation(
    trpc.archivePreview.open.mutationOptions({
      onSuccess: (result) => {
        onOpened?.(result)
        if (navigate) router.push(`/source-preview?preview=${encodeURIComponent(result.previewId)}`)
      },
      onError: () => toast.error('原站预览暂时无法打开，请稍后重试。')
    })
  )

  return (
    <Button
      {...buttonProps}
      type="button"
      disabled={disabled || openPreview.isPending}
      onClick={() => openPreview.mutate({ source })}
    >
      {openPreview.isPending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <ImagesIcon data-icon="inline-start" aria-hidden="true" />
      )}
      {children}
    </Button>
  )
}
