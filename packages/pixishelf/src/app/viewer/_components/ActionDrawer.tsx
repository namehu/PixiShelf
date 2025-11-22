'use client'

import { FC, useState, useEffect } from 'react'
import { RandomImageItem } from '@/types/images'
import { useRouter } from 'next/navigation'
import { CaptionsIcon, User } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter
} from '@/components/ui/drawer'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { useViewerStore } from '@/store/viewerStore'
import { useShallow } from 'zustand/shallow'
import { EMediaType, OMediaType } from '@/enums/EMediaType'

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
 * 现在包含确认保存机制，所有设置变更需要用户确认后才会生效
 */
export const ActionDrawer: FC<ActionDrawerProps> = ({ open, onOpenChange, image }) => {
  const router = useRouter()
  const { author } = image

  // 从store获取当前设置值
  const { titleOpacity, setTitleOpacity, maxImageCount, setMaxImageCount, mediaType, setMediaType } = useViewerStore(
    useShallow((state) => ({
      titleOpacity: state.titleOpacity,
      maxImageCount: state.maxImageCount,
      mediaType: state.mediaType,
      setTitleOpacity: state.setTitleOpacity,
      setMaxImageCount: state.setMaxImageCount,
      setMediaType: state.setMediaType
    }))
  )

  // 临时状态管理 - 用于存储用户调整过程中的临时值
  const [tempTitleOpacity, setTempTitleOpacity] = useState<string>(titleOpacity)
  const [tempMaxImageCount, setTempMaxImageCount] = useState<number>(maxImageCount)
  const [tempMediaType, setTempMediaType] = useState<EMediaType>(mediaType)

  // 当抽屉打开时，初始化临时状态为当前store值
  useEffect(() => {
    if (open) {
      setTempTitleOpacity(titleOpacity)
      setTempMaxImageCount(maxImageCount)
      setTempMediaType(mediaType)
    }
  }, [open, titleOpacity, maxImageCount, mediaType])

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

  // 处理保存操作 - 将临时值提交到store并关闭抽屉
  const handleSave = () => {
    setTitleOpacity(tempTitleOpacity)
    setMaxImageCount(tempMaxImageCount)
    setMediaType(tempMediaType)
    onOpenChange(false)
  }

  // 处理取消操作
  const handleCancel = () => {
    onOpenChange(false)
  }

  // 检查是否有未保存的更改
  const hasUnsavedChanges =
    tempTitleOpacity !== titleOpacity || tempMaxImageCount !== maxImageCount || tempMediaType !== mediaType

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="flex items-center justify-center" onClick={handleViewDetails}>
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

        {/* 设置内容区域 */}
        <div className="p-4 space-y-4 flex-1">
          {/* 标题透明度设置 */}
          <div className="flex justify-between py-2">
            <Label>标题透明度</Label>
            <Tabs value={tempTitleOpacity} onValueChange={setTempTitleOpacity}>
              <TabsList>
                {['0', '25', '60', '100'].map((it) => (
                  <TabsTrigger key={it} value={it}>
                    {it}%
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {/* 最大图片数量设置 */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <Label>最大图片数量</Label>
              <span className="text-sm text-muted-foreground">{tempMaxImageCount}</span>
            </div>
            <Slider
              value={[tempMaxImageCount]}
              onValueChange={(value) => setTempMaxImageCount(value[0]!)}
              max={100}
              min={1}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1</span>
              <span>100</span>
            </div>
          </div>

          {/* 媒体类型设置 */}
          <div className="flex justify-between py-2">
            <Label>媒体类型</Label>
            <Tabs value={tempMediaType} onValueChange={(va: any) => setTempMediaType(va)}>
              <TabsList>
                {OMediaType.map((it) => (
                  <TabsTrigger key={it.value} value={it.value}>
                    {it.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* 底部确认按钮区域 */}
        <DrawerFooter className="pt-2">
          <div className="flex gap-2 w-full">
            <Button variant="outline" onClick={handleCancel} className="flex-1">
              取消
            </Button>
            <Button onClick={handleSave} className="flex-1" disabled={!hasUnsavedChanges}>
              保存
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

export default ActionDrawer
