'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

export interface TagCoverTarget {
  name: string
  image: string
}

export function TagCoverThumbnail({
  tag,
  checked,
  onPreview
}: {
  tag: TagCoverTarget
  checked: boolean
  onPreview: (tag: TagCoverTarget) => void
}) {
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => setLoadFailed(false), [tag.image])

  if (!checked) {
    return (
      <span className="text-muted-foreground" aria-label={`标签 ${tag.name} 尚未生成封面`}>
        -
      </span>
    )
  }

  if (!tag.image || loadFailed) {
    return (
      <span
        className="inline-flex size-11 rounded-md border border-dashed bg-muted/30"
        aria-label={`标签 ${tag.name} 没有封面`}
      />
    )
  }

  return (
    <button
      type="button"
      className="group relative inline-flex size-11 overflow-hidden rounded-md border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => onPreview(tag)}
      aria-label={`查看标签 ${tag.name} 的封面`}
    >
      <Image
        src={tag.image}
        alt=""
        fill
        sizes="44px"
        className="object-cover transition-transform group-hover:scale-105 motion-reduce:transition-none"
        onError={() => setLoadFailed(true)}
      />
    </button>
  )
}

export function TagCoverPreviewDialog({
  tag,
  onOpenChange
}: {
  tag: TagCoverTarget | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={Boolean(tag)} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{tag ? <PrivacySensitiveText>{tag.name}</PrivacySensitiveText> : '标签封面'}</DialogTitle>
          <DialogDescription>Pixiv 标签封面</DialogDescription>
        </DialogHeader>
        <div className="relative aspect-[16/10] min-h-72 w-full bg-neutral-950">
          {tag && (
            <Image
              src={tag.image}
              alt={`标签 ${tag.name} 的 Pixiv 封面`}
              fill
              sizes="(max-width: 768px) 100vw, 768px"
              className="object-contain"
              priority
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
