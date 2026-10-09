'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { FieldGroup } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import type { CreatorOption } from '@/components/creators/creator-picker'
import { ArchiveUploaderIdentityField, type SavedUploaderOption } from './archive-uploader-identity-field'
import { SourceCreatorField } from './source-creator-field'
import { useCreateUploaderSource } from './use-create-uploader-source'

export function ArchiveUploaderSourceForm({
  open,
  onOpenChange,
  onCreated,
  sources = [],
  creators,
  onCreatorsChange,
  onPendingChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (sourceId: string) => Promise<void>
  sources?: SavedUploaderOption[]
  creators: CreatorOption[]
  onCreatorsChange: (value: CreatorOption[]) => void
  onPendingChange?: (value: boolean) => void
}) {
  const { identity, pending, saving, submit } = useCreateUploaderSource({
    open,
    onOpenChange,
    onCreated,
    artistIds: creators.map(({ id }) => id)
  })
  useEffect(() => {
    onPendingChange?.(pending)
  }, [pending, onPendingChange])
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <FieldGroup className="py-5">
        <ArchiveUploaderIdentityField identity={identity} sources={sources} disabled={pending} />
        <SourceCreatorField value={creators} onChange={onCreatorsChange} disabled={pending} />
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button type="submit" disabled={!identity.draft.value.trim() || pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {saving && identity.pending ? '识别并保存中' : '保存来源'}
        </Button>
      </DialogFooter>
    </form>
  )
}
