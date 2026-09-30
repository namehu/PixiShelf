'use client'

import { useState } from 'react'
import { ImageOffIcon, ImagesIcon, ListIcon, LayoutGridIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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
  sourceHref,
  card = false
}: {
  item: ArchiveUploaderPreviewItem
  sourceHref?: string
  card?: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const frameClass = card ? 'h-72 w-full' : 'h-40 w-28 @[36rem]/discovery-results:h-52 @[36rem]/discovery-results:w-40'

  const content = (
    <>
      {item.thumbnailUrl && !failed && !loaded ? <Skeleton className="absolute inset-0 h-full w-full" /> : null}
      {item.thumbnailUrl && !failed ? (
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
      ) : (
        <ImageOffIcon aria-label={`${item.title} 没有可用首图`} />
      )}
      {!sourceHref ? (
        <span className="absolute bottom-2 rounded bg-background/90 px-2 py-1 text-xs text-foreground">
          来源地址不可用
        </span>
      ) : null}
    </>
  )
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
      disabled
      title="来源地址不可用"
      aria-label={`${item.title} 来源地址不可用`}
    >
      {content}
    </Button>
  )
}
