'use client'

import Link from 'next/link'
import { memo, useEffect, useState, type FC } from 'react'
import { PencilIcon, PlusIcon } from 'lucide-react'
import type { TArtworkTagDto } from '@/schemas/artwork.dto'
import { getTranslateName } from '@/utils/tags'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { useArtworkMediaView } from './artwork-media-view-context'
import { TagEditDialog } from './tag-edit-dialog'

interface TagAreaProps {
  artworkId: number
  tags: TArtworkTagDto[]
}

const TagArea: FC<TagAreaProps> = ({ artworkId, tags }) => {
  const [currentTags, setCurrentTags] = useState(tags)
  const [open, setOpen] = useState(false)
  const setReaderBlocked = useArtworkMediaView()?.setReaderBlocked

  useEffect(() => setCurrentTags(tags), [tags])
  useEffect(() => {
    setReaderBlocked?.(open, 'tag-edit')
    return () => setReaderBlocked?.(false, 'tag-edit')
  }, [open, setReaderBlocked])

  return (
    <section aria-labelledby="artwork-tags-heading">
      <h2 id="artwork-tags-heading" className="sr-only">
        标签
      </h2>
      <div className="flex max-w-full flex-wrap items-center gap-2">
        {currentTags.map((tag) => {
          const translatedName = getTranslateName(tag)

          return (
            <Link
              href={`/tags/${tag.id}`}
              key={tag.id}
              className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-sm text-accent-foreground outline-none hover:bg-accent/75 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <PrivacySensitiveText className="break-all font-medium">#{tag.name}</PrivacySensitiveText>
              {translatedName && (
                <PrivacySensitiveText className="truncate text-xs text-muted-foreground">
                  {translatedName}
                </PrivacySensitiveText>
              )}
            </Link>
          )
        })}
        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            if (nextOpen) useArtworkAutoBrowseStore.getState().pause('overlay')
            setOpen(nextOpen)
          }}
        >
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="min-h-11 rounded-full" aria-label="编辑作品标签">
              {currentTags.length ? <PencilIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
              {currentTags.length ? '编辑' : '添加标签'}
            </Button>
          </DialogTrigger>
          {open && (
            <TagEditDialog
              artworkId={artworkId}
              tags={currentTags}
              onCancel={() => setOpen(false)}
              onSaved={(saved) => {
                setCurrentTags(saved)
                setOpen(false)
              }}
            />
          )}
        </Dialog>
      </div>
    </section>
  )
}

export default memo(TagArea)
