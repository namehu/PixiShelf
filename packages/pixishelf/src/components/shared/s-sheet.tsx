import React from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export interface SSheetProps {
  /** 控制显隐 (受控模式) */
  open?: boolean
  /** 显隐回调 */
  onOpenChange?: (open: boolean) => void
  /** 触发器元素 - 如果不传，则需要外部控制 open 状态 */
  trigger?: React.ReactNode
  /** 标题 */
  title?: React.ReactNode
  /** 描述文案 */
  description?: React.ReactNode
  /** 底部内容 (通常放置按钮) */
  footer?: React.ReactNode
  /** 抽屉弹出的方向 */
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** 内容区域的类名，用于覆盖宽度、圆角等 */
  className?: string
  /** 具体的业务内容 */
  children?: React.ReactNode
}

export function SSheet({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  footer,
  side = 'right', // 默认为右侧
  className,
  children
}: SSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* 只有传入 trigger 时才渲染 Trigger 组件 */}
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}

      <SheetContent
        side={side}
        className={cn(
          'flex flex-col h-full', // 确保内容区可以撑开布局
          className
        )}
      >
        {(title || description) && (
          <SheetHeader className="text-left">
            {title && <SheetTitle>{title}</SheetTitle>}
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
        )}

        {/* 内容区域：自动占据剩余空间并支持滚动 */}
        <div className="flex-1 overflow-y-auto py-6">{children}</div>

        {footer && <SheetFooter>{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  )
}
