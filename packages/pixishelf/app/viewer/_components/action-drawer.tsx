'use client'

import type { FC } from 'react'
import type { RandomImageItem } from '@/types/images'
import { useRouter } from 'next/navigation'
import { CaptionsIcon, EyeOffIcon, User } from 'lucide-react'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

export interface ActionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  image: RandomImageItem
  onEnterClearMode: () => void
}

/** 当前作品的快捷操作；Feed 级设置统一由页面右上角的筛选入口管理。 */
export const ActionDrawer: FC<ActionDrawerProps> = ({ open, onOpenChange, image, onEnterClearMode }) => {
  const router = useRouter()
  const { author } = image

  const navigate = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-center">{image.title || '未知标题'}</DrawerTitle>
          {author && (
            <DrawerDescription className="text-center">
              {author.name || author.username || '未知作者'}
            </DrawerDescription>
          )}
        </DrawerHeader>
        <Separator />
        <div className="flex flex-col gap-2 p-4">
          <Button type="button" variant="outline" className="w-full justify-start" onClick={() => navigate(`/artworks/${image.id}`)}>
            <CaptionsIcon className="mr-2 size-4" />
            查看作品详情
          </Button>
          {author?.id && (
            <Button type="button" variant="outline" className="w-full justify-start" onClick={() => navigate(`/artists/${author.id}`)}>
              <User className="mr-2 size-4" />
              查看艺术家
            </Button>
          )}
          <Button type="button" variant="outline" className="w-full justify-start" onClick={onEnterClearMode}>
            <EyeOffIcon className="mr-2 size-4" />
            清屏播放
          </Button>
        </div>
        <DrawerFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export default ActionDrawer
