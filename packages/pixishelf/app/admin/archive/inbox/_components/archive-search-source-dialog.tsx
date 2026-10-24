'use client'
import { useEffect, useState, type ComponentProps } from 'react'
import type { CreatorOption } from '@/components/creators/creator-picker'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import type { SavedUploaderOption } from './archive-uploader-identity-field'
import { ArchiveSearchSourceForm } from './archive-search-source-form'
import type { ArchiveSearchDialogState } from './use-archive-search-source'
export type { ArchiveSearchDialogState } from './use-archive-search-source'

export function ArchiveSearchSourceDialog({
  state,
  onClose,
  onSaved,
  sources = []
}: {
  state: ArchiveSearchDialogState | null
  onClose: () => void
  onSaved: (sourceId: string) => Promise<void>
  sources?: SavedUploaderOption[]
}) {
  const [pending, setPending] = useState(false)
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent
        fitViewport={state !== null}
        className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl [&>[data-slot=dialog-close]]:top-2 [&>[data-slot=dialog-close]]:right-2 [&>[data-slot=dialog-close]]:flex [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:items-center [&>[data-slot=dialog-close]]:justify-center"
      >
        <DialogHeader className="shrink-0 border-b px-5 pt-5 pb-4 text-left">
          <DialogTitle>
            {state?.mode === 'RENAME' ? '修改来源名称' : state?.mode === 'COPY' ? '另存搜索条件' : '新增标题关键词来源'}
          </DialogTitle>
          <DialogDescription>远端关键词和上传者保存后固定；本地接纳规则可在来源详情中预览并调整。</DialogDescription>
        </DialogHeader>
        <SearchEditor
          state={state}
          onClose={() => {
            setPending(false)
            onClose()
          }}
          onSaved={onSaved}
          sources={sources}
          onPendingChange={setPending}
        />
      </DialogContent>
    </Dialog>
  )
}

function SearchEditor(props: Omit<ComponentProps<typeof ArchiveSearchSourceForm>, 'creators' | 'onCreatorsChange'>) {
  const [creators, setCreators] = useState<CreatorOption[]>(props.state?.initialValues?.creators ?? [])
  useEffect(() => {
    setCreators(props.state?.initialValues?.creators ?? [])
  }, [props.state])
  return <ArchiveSearchSourceForm {...props} creators={creators} onCreatorsChange={setCreators} />
}
