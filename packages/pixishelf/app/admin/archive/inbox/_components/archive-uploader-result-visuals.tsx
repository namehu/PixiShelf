'use client'

import { useState } from 'react'
import { ImageOffIcon, ImagesIcon, ListIcon, LayoutGridIcon } from 'lucide-react'
import { SourcePreviewButton } from '@/components/source-preview/source-preview-button'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import type { ArchiveUploaderResultView } from '@/store/admin/use-admin-preferences-store'

export interface ArchiveUploaderPreviewItem {
  id: string
  externalId: string
  thumbnailUrl: string | null
  title: string
}

const resultViewOptions = [
  { value: 'list', label: '纯列表', action: '使用纯列表', icon: ListIcon },
  { value: 'preview', label: '首图预览', action: '显示首图预览', icon: ImagesIcon },
  { value: 'cards', label: '卡片', action: '使用卡片模式', icon: LayoutGridIcon }
] as const

export function ArchiveUploaderResultViewToggle({
  value,
  onChange
}: {
  value: ArchiveUploaderResultView
  onChange: (view: ArchiveUploaderResultView) => void
}) {
  const current = resultViewOptions.find((option) => option.value === value) ?? resultViewOptions[0]
  const CurrentIcon = current.icon
  const label = `显示模式：${current.label}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label={label} title={label}>
          <CurrentIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>显示模式</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => {
              const option = resultViewOptions.find((option) => option.value === next)
              if (option) onChange(option.value)
            }}
          >
            {resultViewOptions.map(({ value, label, action, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value} aria-label={action}>
                <Icon aria-hidden="true" />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ArchiveUploaderGalleryThumbnail({
  item,
  onPreview,
  sourceHref,
  card = false,
  previewCatalogId
}: {
  item: ArchiveUploaderPreviewItem
  onPreview?: (item: ArchiveUploaderPreviewItem) => void
  sourceHref?: string
  card?: boolean
  previewCatalogId?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const frameClass = card ? 'h-72 w-full' : 'h-40 w-28 @[36rem]/discovery-results:h-52 @[36rem]/discovery-results:w-40'

  if (!item.thumbnailUrl || failed) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground',
          frameClass
        )}
        aria-label={`${item.title} 没有可用首图`}
      >
        <ImageOffIcon aria-hidden="true" />
      </div>
    )
  }

  const content = (
    <>
      {!loaded ? <Skeleton className="absolute inset-0 h-full w-full" /> : null}
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
    </>
  )
  if (previewCatalogId) {
    return (
      <SourcePreviewButton
        source={{ kind: 'catalog', itemId: previewCatalogId }}
        showIcon={false}
        variant="ghost"
        className={cn('relative shrink-0 overflow-hidden bg-muted/40 p-0', frameClass)}
        aria-label={`预览 ${item.title} 的图片`}
      >
        {content}
      </SourcePreviewButton>
    )
  }
  if (sourceHref) {
    return (
      <Button variant="ghost" className={cn('relative shrink-0 overflow-hidden bg-muted/40 p-0', frameClass)} asChild>
        <a
          href={sourceHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`在新标签页打开原站 ${item.title}`}
          title="在新标签页打开原站"
        >
          {content}
        </a>
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn('relative shrink-0 overflow-hidden bg-muted/40 p-0', frameClass)}
      onClick={() => onPreview?.(item)}
      aria-label={`预览 ${item.title} 的首图`}
    >
      {content}
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
          <DialogTitle>{item ? <PrivacySensitiveText>{item.title}</PrivacySensitiveText> : '首图预览'}</DialogTitle>
          <DialogDescription>{item ? `#${item.externalId} · 扫描结果首图` : '扫描结果首图'}</DialogDescription>
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
