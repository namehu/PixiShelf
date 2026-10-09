'use client'
import { useCallback, useState } from 'react'
import type { CreatorOption } from '@/components/creators/creator-picker'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArchiveUploaderSourceForm } from './archive-uploader-source-form'
import { ArchiveSearchSourceForm } from './archive-search-source-form'
import type { SavedUploaderOption } from './archive-uploader-identity-field'
import type { ArchiveSearchDialogState } from './use-archive-search-source'

interface Props {
  open: boolean
  onOpenChange: (value: boolean) => void
  onCreated: (sourceId: string) => Promise<void>
  sources?: SavedUploaderOption[]
}
const createSearchState: ArchiveSearchDialogState = { mode: 'CREATE' }

export function ArchiveCreateSourceDialog(props: Props) {
  const [pending, setPending] = useState(false)
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!pending) props.onOpenChange(open)
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>新增来源</DialogTitle>
          <DialogDescription>选择来源类型，可同时绑定艺术家。保存后手动启动扫描。</DialogDescription>
        </DialogHeader>
        <CreateSourceForms
          {...props}
          onOpenChange={(open) => {
            setPending(false)
            props.onOpenChange(open)
          }}
          onPendingChange={setPending}
        />
      </DialogContent>
    </Dialog>
  )
}

function CreateSourceForms({
  open,
  onOpenChange,
  onCreated,
  sources,
  onPendingChange
}: Props & {
  onPendingChange: (pending: boolean) => void
}) {
  const [kind, setKind] = useState('uploader')
  const [creators, setCreators] = useState<CreatorOption[]>([])
  const [pending, setPending] = useState(false)
  const updatePending = useCallback(
    (value: boolean) => {
      setPending(value)
      onPendingChange(value)
    },
    [onPendingChange]
  )
  return (
    <Tabs
      value={kind}
      onValueChange={(value) => {
        if (!pending) setKind(value)
      }}
    >
      <TabsList aria-label="新增来源类型">
        <TabsTrigger value="uploader" disabled={pending}>
          上传者
        </TabsTrigger>
        <TabsTrigger value="keyword" disabled={pending}>
          标题关键词
        </TabsTrigger>
      </TabsList>
      <TabsContent value="uploader" hidden={kind !== 'uploader'} forceMount className="data-[state=inactive]:hidden">
        <ArchiveUploaderSourceForm
          open={open}
          onOpenChange={onOpenChange}
          onCreated={onCreated}
          sources={sources}
          creators={creators}
          onCreatorsChange={setCreators}
          onPendingChange={updatePending}
        />
      </TabsContent>
      <TabsContent value="keyword" hidden={kind !== 'keyword'} forceMount className="data-[state=inactive]:hidden">
        <ArchiveSearchSourceForm
          state={createSearchState}
          onClose={() => onOpenChange(false)}
          onSaved={onCreated}
          sources={sources}
          creators={creators}
          onCreatorsChange={setCreators}
          onPendingChange={updatePending}
        />
      </TabsContent>
    </Tabs>
  )
}
