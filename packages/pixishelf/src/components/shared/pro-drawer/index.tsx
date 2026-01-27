'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger
} from '@/components/ui/drawer' // 引用你提供的 drawer.tsx 路径
import { type DialogProps } from 'vaul'
// 定义 ProDrawer 的属性接口
export interface ProDrawerProps extends Omit<DialogProps, 'direction' | 'fadeFromIndex'> {
  /**
   * 触发抽屉打开的元素
   */
  trigger?: React.ReactNode
  /**
   * 抽屉标题
   */
  title?: React.ReactNode
  /**
   * 抽屉描述/副标题
   */
  description?: React.ReactNode
  /**
   * 底部区域自定义内容。
   * 传 null 或 false 可隐藏默认 padding
   */
  footer?: React.ReactNode | boolean
  /**
   * 抽屉打开的方向
   * @default 'bottom'
   */
  direction?: 'top' | 'bottom' | 'left' | 'right'
  /**
   * 内容区域的类名
   */
  bodyClassName?: string
  /**
   * 整个 Content 容器的类名 (用于控制宽度/高度等)
   */
  className?: string
  /**
   * 抽屉内容
   */
  children?: React.ReactNode
}

export function ProDrawer({
  trigger,
  title,
  description,
  footer,
  children,
  className,
  bodyClassName,
  direction = 'bottom',
  ...props
}: ProDrawerProps) {
  // 判断是否需要显示 Header
  const showHeader = title || description

  return (
    <Drawer direction={direction} {...props}>
      {/* 触发器逻辑 */}
      {trigger && <DrawerTrigger asChild>{trigger}</DrawerTrigger>}

      <DrawerContent className={cn('flex flex-col', className)}>
        {/* 头部区域 */}
        {showHeader && (
          <DrawerHeader className="shrink-0">
            {title && <DrawerTitle>{title}</DrawerTitle>}
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>
        )}

        {/* 内容区域
           使用 flex-1 和 overflow-auto 确保头部和底部固定时，内容可滚动
        */}
        <div className={cn('flex-1 overflow-y-auto px-4 py-2', bodyClassName)}>{children}</div>

        {/* 底部区域 */}
        {footer !== false && footer !== null && (
          <DrawerFooter className="shrink-0">
            {/* 如果传入了具体的 footer 内容则渲染，否则默认渲染一个关闭按钮 */}
            {footer ? (
              footer
            ) : (
              <DrawerClose asChild>
                <button className="bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50">
                  Close
                </button>
              </DrawerClose>
            )}
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  )
}
