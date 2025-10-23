'use client'

import { FC } from 'react'
import { RandomImageItem } from '@/types/images'
import { useRouter } from 'next/navigation'
import { CaptionsIcon, User } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { useViewerStore } from '@/store/viewerStore'

export interface ActionDrawerProps {
  /** 是否显示抽屉 */
  open: boolean
  /** 控制抽屉显示状态的回调 */
  onOpenChange: (open: boolean) => void
  /** 图片数据 */
  image: RandomImageItem
}

/**
 * 操作抽屉组件
 * 使用Drawer组件实现的操作菜单，支持查看详情、查看作者等功能
 */
export const ActionDrawer: FC<ActionDrawerProps> = ({ open, onOpenChange, image }) => {
  const router = useRouter()
  const { author } = image

  const { titleOpacity, setTitleOpacity } = useViewerStore()

  // 处理查看详情
  const handleViewDetails = () => {
    onOpenChange(false)
    router.push(`/artworks/${image.id}`)
  }

  // 处理查看作者
  const handleViewAuthor = () => {
    onOpenChange(false)
    if (author?.id) {
      router.push(`/artists/${author.id}`)
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="flex items-center  justify-center " onClick={handleViewDetails}>
            <CaptionsIcon className="mr-3 h-4 w-4" />
            {image.title || '未知标题'}
          </DrawerTitle>
          {author?.id && (
            <DrawerDescription className="flex items-center w-full justify-center mt-2" onClick={handleViewAuthor}>
              <User className="mr-3 h-4 w-4" />
              {image.author?.username || '未知作者'}
            </DrawerDescription>
          )}
        </DrawerHeader>
        <Separator />
        <div className="p-4">
          <div className="flex justify-between py-2">
            <Label>标题透明度</Label>
            <Tabs defaultValue={titleOpacity} onValueChange={setTitleOpacity}>
              <TabsList>
                {['0', '25', '60', '100'].map((it) => (
                  <TabsTrigger key={it} value={it}>
                    {it}%
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export default ActionDrawer
