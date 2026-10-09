'use client'
import { useState } from 'react'
import type { CreatorOption } from '@/components/creators/creator-picker'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ArchiveUploaderSourceForm } from './archive-uploader-source-form'
import type { SavedUploaderOption } from './archive-uploader-identity-field'

export function ArchiveUploaderCreateSourceDialog({
  open,
  onOpenChange,
  onCreated,
  sources
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (sourceId: string) => Promise<void>
  sources?: SavedUploaderOption[]
}) {
  const [pending, setPending] = useState(false)
  const [creators, setCreators] = useState<CreatorOption[]>([])
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) onOpenChange(value)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增上传者来源</DialogTitle>
          <DialogDescription>输入原站上的完整上传者名称，系统自动识别账号。</DialogDescription>
        </DialogHeader>
        <ArchiveUploaderSourceForm
          open={open}
          onOpenChange={(open) => {
            setPending(false)
            onOpenChange(open)
          }}
          onCreated={onCreated}
          sources={sources}
          creators={creators}
          onCreatorsChange={setCreators}
          onPendingChange={setPending}
        />
      </DialogContent>
    </Dialog>
  )
}
