'use client'

import type { FC } from 'react'
import type { RandomImageItem } from '@/types/images'
import Link from 'next/link'
import { CaptionsIcon, PlayIcon, SquareIcon, User } from 'lucide-react'
import { useViewerStore, VIEWER_AUTO_INTERVALS } from '@/store/viewer-store'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { MediaMarkActions } from '@/components/media-mark/media-mark-actions'

export interface ActionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  image: RandomImageItem
  currentMediaId?: number | null
}

/** 当前作品的快捷操作；Feed 级设置统一由页面右上角的筛选入口管理。 */
export const ActionDrawer: FC<ActionDrawerProps> = ({ open, onOpenChange, image, currentMediaId = null }) => {
  const autoStatus = useViewerStore((state) => state.autoBrowseStatus)
  const interval = useViewerStore((state) => state.autoBrowseInterval)
  const autoSelected = autoStatus === 'running' || autoStatus === 'paused'
  const { author } = image
  const authors = image.authors ?? (author ? [author] : [])

  return (
    <Drawer autoFocus open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <PrivacySensitiveText as={DrawerTitle} className="text-center">
            {image.title || '未知标题'}
          </PrivacySensitiveText>
          {author && (
            <PrivacySensitiveText as={DrawerDescription} className="text-center">
              {author.name || author.username || '未知作者'}
            </PrivacySensitiveText>
          )}
        </DrawerHeader>
        <Separator />
        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-4">
          {open && (
            <section aria-label="当前图片" className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">当前图片</p>
              <MediaMarkActions artworkId={image.id} mediaId={currentMediaId} layout="menu" showBookmark={false} />
              {!currentMediaId ? <p className="text-xs text-muted-foreground">当前仅展示作品封面，暂无可标记的图片。</p> : null}
              <Separator />
            </section>
          )}
          <Button
            className="min-h-11 w-full justify-start"
            onClick={() => {
              onOpenChange(false)
              useViewerStore.getState().requestAutoBrowse()
            }}
          >
            <PlayIcon data-icon="inline-start" aria-hidden="true" />
            {autoSelected ? '继续自动浏览' : '开始自动浏览'}
          </Button>
          <div className="flex flex-col gap-2 py-2">
            <span id={`viewer-interval-${image.id}`} className="text-sm text-muted-foreground">
              图片停留时间
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={2}
              value={String(interval)}
              aria-labelledby={`viewer-interval-${image.id}`}
              onValueChange={(value) => {
                if (value) useViewerStore.getState().setAutoBrowseInterval(Number(value))
              }}
            >
              {VIEWER_AUTO_INTERVALS.map((seconds) => (
                <ToggleGroupItem key={seconds} value={String(seconds)} className="min-h-11 min-w-11">
                  {seconds} 秒
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {autoSelected && (
            <Button
              variant="outline"
              className="min-h-11 w-full justify-start"
              onClick={() => {
                useViewerStore.getState().stopAutoBrowse()
                onOpenChange(false)
              }}
            >
              <SquareIcon data-icon="inline-start" aria-hidden="true" />
              关闭自动浏览
            </Button>
          )}
          <Separator />
          <Button variant="outline" className="w-full justify-start" asChild>
            <Link href={`/artworks/${image.id}`} onClick={() => onOpenChange(false)}>
              <CaptionsIcon data-icon="inline-start" aria-hidden="true" />
              查看作品详情
            </Link>
          </Button>
          {authors.map((creator) => (
            <Button key={creator.id} variant="outline" className="w-full justify-start" asChild>
              <Link href={'/artists/' + creator.id} onClick={() => onOpenChange(false)}>
                <User data-icon="inline-start" aria-hidden="true" />
                查看艺术家{authors.length > 1 && <PrivacySensitiveText>：{creator.name}</PrivacySensitiveText>}
              </Link>
            </Button>
          ))}
        </div>
        <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export default ActionDrawer
