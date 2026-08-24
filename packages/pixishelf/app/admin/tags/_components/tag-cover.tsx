'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Eye, ImageOff } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface TagCoverTarget {
  name: string
  image: string
}

export function TagCoverThumbnail({
  tag,
  onPreview
}: {
  tag: TagCoverTarget
  onPreview: (tag: TagCoverTarget) => void
}) {
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => setLoadFailed(false), [tag.image])

  if (!tag.image || loadFailed) {
    return (
      <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <span className="flex size-11 items-center justify-center rounded-md border border-dashed bg-muted/30">
          <ImageOff className="size-4" aria-hidden="true" />
        </span>
        <span>{loadFailed ? '读取失败' : '无封面'}</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="group inline-flex items-center gap-2 rounded-md text-left text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => onPreview(tag)}
      aria-label={`查看标签 ${tag.name} 的封面`}
    >
      <span className="relative size-11 overflow-hidden rounded-md border bg-muted">
        <Image
          src={tag.image}
          alt=""
          fill
          sizes="44px"
          className="object-cover transition-transform group-hover:scale-105 motion-reduce:transition-none"
          onError={() => setLoadFailed(true)}
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-colors group-hover:bg-black/45 group-hover:opacity-100 group-focus-visible:bg-black/45 group-focus-visible:opacity-100 motion-reduce:transition-none">
          <Eye className="size-4" aria-hidden="true" />
        </span>
      </span>
      <span>有封面</span>
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
          <DialogTitle>{tag?.name || '标签封面'}</DialogTitle>
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
