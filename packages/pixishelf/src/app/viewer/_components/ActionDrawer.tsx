'use client'

import { FC } from 'react'
import { RandomImageItem } from '@/types/images'
import { useRouter } from 'next/navigation'
import { CaptionsIcon, Eye, User, X } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle
} from '@/components/ui/drawer'
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

  // 处理取消
  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-sm">
          <DrawerHeader>
            <DrawerTitle>操作菜单</DrawerTitle>
            <DrawerDescription>选择你要执行的操作</DrawerDescription>
          </DrawerHeader>

          <div className="pb-4">
            <div className="">
              {/* 查看详情按钮 */}
              <div className="flex items-center w-full justify-start h-12" onClick={handleViewDetails}>
                <CaptionsIcon className="mr-3 h-4 w-4" />
                {image.title || '未知标题'}
              </div>
              <Separator className="my-0" />
              {/* 查看作者按钮 */}
              {author?.id && (
                <div className="flex items-center w-full justify-start h-12" onClick={handleViewAuthor}>
                  <User className="mr-3 h-4 w-4" />
                  {image.author?.username || '未知作者'}
                </div>
              )}
              <Separator className="my-0" />

              <div className="flex justify-between py-2">
                <Label>标题透明度</Label>
                <Tabs defaultValue={titleOpacity} onValueChange={setTitleOpacity}>
                  <TabsList>
                    <TabsTrigger value="0">0%</TabsTrigger>
                    <TabsTrigger value="25">25%</TabsTrigger>
                    <TabsTrigger value="60">60%</TabsTrigger>
                    <TabsTrigger value="100">100%</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>
          </div>

          {/* <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" onClick={handleCancel}>
                <X className="mr-2 h-4 w-4" />
                取消
              </Button>
            </DrawerClose>
          </DrawerFooter> */}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export default ActionDrawer
