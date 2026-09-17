'use client'

import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'

export interface DiscoveryIgnoreSelection {
  sourceId: string
  items: { id: string; title: string }[]
}

export function ArchiveDiscoveryIgnoreDialog({
  selection,
  pending,
  onClose,
  onConfirm
}: {
  selection: DiscoveryIgnoreSelection | null
  pending: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog
      open={Boolean(selection)}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认忽略 {selection?.items.length ?? 0} 个作品？</AlertDialogTitle>
          <AlertDialogDescription>
            将跨来源持续忽略这些作品，后续扫描仍保持忽略，可在全局已忽略中恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {selection?.items.length === 1 ? (
          <PrivacySensitiveText className="break-words">{selection.items[0]!.title}</PrivacySensitiveText>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || !selection?.items.length}
            onClick={(event) => {
              event.preventDefault()
              if (!pending) onConfirm()
            }}
          >
            {pending ? '正在忽略…' : '确认忽略'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
