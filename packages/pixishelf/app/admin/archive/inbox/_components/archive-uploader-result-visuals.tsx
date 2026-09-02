'use client'

import { useState } from 'react'
import { ImageOffIcon, ImagesIcon, ListIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ArchiveUploaderResultView } from '@/store/admin/use-admin-preferences-store'

export interface ArchiveUploaderPreviewItem {
  id: string
  externalId: string
  thumbnailUrl: string | null
  title: string
}

export function ArchiveUploaderResultViewToggle({
  value,
  onChange
}: {
  value: ArchiveUploaderResultView
  onChange: (view: ArchiveUploaderResultView) => void
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(next) => next && onChange(next as ArchiveUploaderResultView)}
      variant="outline"
      size="sm"
      aria-label="结果显示模式"
    >
      <ToggleGroupItem value="list" aria-label="使用纯列表">
        <ListIcon aria-hidden="true" />
        纯列表
      </ToggleGroupItem>
      <ToggleGroupItem value="preview" aria-label="显示首图预览">
        <ImagesIcon aria-hidden="true" />
        首图预览
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

export function ArchiveUploaderGalleryThumbnail({
  item,
  onPreview
}: {
  item: ArchiveUploaderPreviewItem
  onPreview: (item: ArchiveUploaderPreviewItem) => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!item.thumbnailUrl || failed) {
    return (
      <div
        className="flex h-20 w-16 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        aria-label={`${item.title} 没有可用首图`}
      >
        <ImageOffIcon aria-hidden="true" />
      </div>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="relative h-20 w-16 shrink-0 overflow-hidden p-0"
      onClick={() => onPreview(item)}
      aria-label={`预览 ${item.title} 的首图`}
    >
      {!loaded ? <Skeleton className="absolute inset-0 h-full w-full" /> : null}
      {/* next/image 的项目级 loader 仅接受本地 /media 路径；远端地址已在服务端严格校验。 */}
      <img
        src={item.thumbnailUrl}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className={cn('h-full w-full object-contain', !loaded && 'opacity-0')}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </Button>
  )
}

export function ArchiveUploaderGalleryPreviewDialog({
  item,
  onOpenChange
}: {
  item: ArchiveUploaderPreviewItem | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{item?.title ?? '首图预览'}</DialogTitle>
          <DialogDescription>{item ? `E-Hentai #${item.externalId} · 扫描结果首图` : '扫描结果首图'}</DialogDescription>
        </DialogHeader>
        {item?.thumbnailUrl ? (
          <GalleryPreviewImage key={item.thumbnailUrl} src={item.thumbnailUrl} title={item.title} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function GalleryPreviewImage({ src, title }: { src: string; title: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <div className="relative flex min-h-72 items-center justify-center overflow-hidden rounded-md bg-muted">
      {!loaded && !failed ? <Skeleton className="absolute inset-0 h-full w-full" /> : null}
      {failed ? (
        <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <ImageOffIcon aria-hidden="true" />
          首图加载失败
        </div>
      ) : (
        <img
          src={src}
          alt={`${title} 的首图预览`}
          decoding="async"
          referrerPolicy="no-referrer"
          className={cn('max-h-[70vh] max-w-full object-contain', !loaded && 'opacity-0')}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}
