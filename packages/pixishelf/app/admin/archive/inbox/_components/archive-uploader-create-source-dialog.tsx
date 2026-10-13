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
      <DialogContent
        fitViewport={open}
        className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl [&>[data-slot=dialog-close]]:top-2 [&>[data-slot=dialog-close]]:right-2 [&>[data-slot=dialog-close]]:flex [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:items-center [&>[data-slot=dialog-close]]:justify-center"
      >
        <DialogHeader className="shrink-0 border-b px-5 pt-5 pb-4 text-left">
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
