'use client'
import { useState, type ComponentProps } from 'react'
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
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {state?.mode === 'RENAME' ? '修改来源名称' : state?.mode === 'COPY' ? '另存搜索条件' : '新增标题关键词来源'}
          </DialogTitle>
          <DialogDescription>条件保存后固定不变；修改条件请另存来源。</DialogDescription>
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
  const [creators, setCreators] = useState<CreatorOption[]>([])
  return <ArchiveSearchSourceForm {...props} creators={creators} onCreatorsChange={setCreators} />
}
