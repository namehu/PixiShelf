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
      <DialogContent
        fitViewport={props.open}
        className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl [&>[data-slot=dialog-close]]:top-2 [&>[data-slot=dialog-close]]:right-2 [&>[data-slot=dialog-close]]:flex [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:items-center [&>[data-slot=dialog-close]]:justify-center"
      >
        <DialogHeader className="shrink-0 border-b px-5 pt-5 pb-4 text-left">
          <DialogTitle>新增来源</DialogTitle>
          <DialogDescription>保存来源后，手动启动扫描。</DialogDescription>
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
      className="flex min-h-0 flex-1 flex-col gap-0"
      onValueChange={(value) => {
        if (!pending) setKind(value)
      }}
    >
      <TabsList aria-label="新增来源类型" className="mx-5 mt-4 grid h-11 w-auto shrink-0 grid-cols-2">
        <TabsTrigger value="uploader" disabled={pending}>
          上传者
        </TabsTrigger>
        <TabsTrigger value="keyword" disabled={pending}>
          标题关键词
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="uploader"
        hidden={kind !== 'uploader'}
        forceMount
        className="min-h-0 flex flex-1 flex-col data-[state=inactive]:hidden"
      >
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
      <TabsContent
        value="keyword"
        hidden={kind !== 'keyword'}
        forceMount
        className="min-h-0 flex flex-1 flex-col data-[state=inactive]:hidden"
      >
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
