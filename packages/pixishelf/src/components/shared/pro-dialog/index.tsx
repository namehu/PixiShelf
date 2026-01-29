import * as React from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ProDialogProps {
  /** 控制弹窗显示隐藏 (受控) */
  open?: boolean
  /** 状态改变回调，用于受控模式或关闭 */
  onOpenChange?: (open: boolean) => void
  /** 点击确定回调 */
  onOk?: (e: React.MouseEvent<HTMLButtonElement>) => void
  /** 点击取消或关闭回调 */
  onCancel?: (e: React.MouseEvent<HTMLButtonElement> | Event) => void
  /** 标题 */
  title?: React.ReactNode
  /** 内容 */
  children?: React.ReactNode
  /** 底部内容，设置为 null 隐藏 */
  footer?: React.ReactNode
  /** 确定按钮文字 */
  okText?: React.ReactNode
  /** 取消按钮文字 */
  cancelText?: React.ReactNode
  /** 确定按钮 props */
  okButtonProps?: React.ComponentProps<typeof Button>
  /** 取消按钮 props */
  cancelButtonProps?: React.ComponentProps<typeof Button>
  /** 确定按钮 loading 状态 */
  confirmLoading?: boolean
  /** 宽度 */
  width?: string | number
  /** 描述 (Accessibility) */
  description?: React.ReactNode
  /** 额外的 DialogContent 类名 */
  className?: string
  /** 是否显示右上角关闭按钮 */
  showCloseButton?: boolean
}

/**
 * 符合 Ant Design 规范的 Dialog 组件
 * 基于 shadcn/ui Dialog 封装
 */
export function ProDialog({
  open,
  onOpenChange,
  onOk,
  onCancel,
  title,
  children,
  footer,
  okText = '确定',
  cancelText = '取消',
  okButtonProps,
  cancelButtonProps,
  confirmLoading = false,
  width,
  description,
  className,
  showCloseButton = true
}: ProDialogProps) {
  // 处理 onOpenChange，适配 Antd 的 onCancel
  // 当用户点击遮罩层、ESC 或右上角关闭按钮时触发
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // 触发 onCancel 回调
      // 构造一个模拟的 Event 对象，因为 onOpenChange 没有提供原生事件
      const syntheticEvent = new Event('close')
      onCancel?.(syntheticEvent)
    }

    onOpenChange?.(newOpen)
  }

  const handleCancelClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onCancel?.(e)
    // 显式调用 onOpenChange 关闭
    if (onOpenChange) {
      onOpenChange(false)
    }
  }

  const handleOkClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onOk?.(e)
  }

  // 默认 Footer
  const defaultFooter = (
    <>
      <Button variant="outline" onClick={handleCancelClick} {...cancelButtonProps}>
        {cancelText}
      </Button>
      <Button onClick={handleOkClick} disabled={confirmLoading} {...okButtonProps}>
        {confirmLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {okText}
      </Button>
    </>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn('sm:max-w-lg', className)}
        style={width ? { maxWidth: width, width: '100%' } : undefined}
        showCloseButton={showCloseButton}
      >
        <DialogHeader>
          {title && <DialogTitle>{title}</DialogTitle>}
          {/* 如果没有提供 description，渲染一个空的 Description 或者 VisuallyHidden 的，避免 Radix 警告 */}
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Dialog Content</DialogDescription>
          )}
        </DialogHeader>

        <div className="py-2">{children}</div>

        {footer === null ? null : <DialogFooter>{footer || defaultFooter}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
