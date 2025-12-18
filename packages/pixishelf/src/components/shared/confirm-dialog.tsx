import React from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'

interface ConfirmDialogProps {
  /** 控制弹窗显示隐藏 */
  open: boolean
  /** 状态改变回调 */
  onOpenChange: (open: boolean) => void
  /** 标题 */
  title: React.ReactNode
  /** 描述内容 (可选) */
  description?: React.ReactNode
  /** 确认按钮文字 (默认: 确认) */
  confirmText?: string
  /** 取消按钮文字 (默认: 取消) */
  cancelText?: string
  /** 确认按钮点击回调 */
  onConfirm: (e: React.MouseEvent<HTMLButtonElement>) => void
  /** 确认按钮的样式变体 (默认: default, 删除操作建议用 destructive) */
  variant?: 'default' | 'destructive'
  /** 是否处于加载中 (会禁用按钮) */
  loading?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  variant = 'default',
  loading = false
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // 如果需要阻止默认关闭行为（例如异步操作），可以在 onConfirm 里调用 e.preventDefault()
              onConfirm(e)
            }}
            disabled={loading}
            // 根据 variant 动态调整样式，如果是 destructive 则显示红色
            className={variant === 'destructive' ? 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-600' : ''}
          >
            {loading ? '处理中...' : confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
