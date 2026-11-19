'use client'

import { useState, type ReactNode } from 'react'
import { CreatorPicker, type CreatorOption } from '@/components/creators/creator-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export function ArchiveIntakeCreatorsDialog({
  description,
  saveToSource,
  onClose,
  onConfirm
}: {
  description: ReactNode
  saveToSource: boolean
  onClose: () => void
  onConfirm: (ids: number[]) => void
}) {
  const [artists, setArtists] = useState<CreatorOption[]>([])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>指定本站艺术家</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <CreatorPicker value={artists} onChange={setArtists} presentation="dialog" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!artists.length} onClick={() => onConfirm(artists.map(({ id }) => id))}>
            {saveToSource ? '绑定到此来源并加入收件箱' : '确认并加入收件箱'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
