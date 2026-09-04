'use client'

import type { FC } from 'react'
import type { RandomImageItem } from '@/types/images'
import Link from 'next/link'
import { CaptionsIcon, EyeOffIcon, User } from 'lucide-react'
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

export interface ActionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  image: RandomImageItem
  onEnterClearMode: () => void
}

/** 当前作品的快捷操作；Feed 级设置统一由页面右上角的筛选入口管理。 */
export const ActionDrawer: FC<ActionDrawerProps> = ({ open, onOpenChange, image, onEnterClearMode }) => {
  const { author } = image

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
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
        <div className="flex flex-col gap-2 p-4">
          <Button variant="outline" className="w-full justify-start" asChild>
            <Link href={`/artworks/${image.id}`} onClick={() => onOpenChange(false)}>
              <CaptionsIcon data-icon="inline-start" aria-hidden="true" />
              查看作品详情
            </Link>
          </Button>
          {author?.id && (
            <Button variant="outline" className="w-full justify-start" asChild>
              <Link href={`/artists/${author.id}`} onClick={() => onOpenChange(false)}>
                <User data-icon="inline-start" aria-hidden="true" />
                查看艺术家
              </Link>
            </Button>
          )}
          <Button type="button" variant="outline" className="w-full justify-start" onClick={onEnterClearMode}>
            <EyeOffIcon data-icon="inline-start" aria-hidden="true" />
            清屏播放
          </Button>
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
