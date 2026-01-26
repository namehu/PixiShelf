// oxlint-disable no-console
'use client'

import { create } from 'zustand'
import { ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/**
 * 定义弹窗的配置项接口
 */
interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  confirmText?: string
  cancelText?: string
  /**
   * 点击确认的回调
   * 如果返回 Promise，按钮会自动进入 loading 状态，等待 Promise resolve 后关闭
   */
  onConfirm?: () => void | Promise<void>
  onCancel?: () => void
  variant?: 'default' | 'destructive'
}

interface ConfirmStore {
  isOpen: boolean
  isLoading: boolean
  options: ConfirmOptions
  show: (opts: ConfirmOptions) => void
  close: () => void
  setLoading: (loading: boolean) => void
}

/**
 * 1. 创建 Zustand Store 来管理全局状态
 */
const useConfirmStore = create<ConfirmStore>((set) => ({
  isOpen: false,
  isLoading: false,
  options: { title: '提示', onConfirm: () => {} },
  show: (opts) => set({ isOpen: true, options: opts, isLoading: false }),
  close: () => set({ isOpen: false }),
  setLoading: (loading) => set({ isLoading: loading })
}))

/**
 * 2. 导出类似 Antd 的命令式调用函数
 * 可以在任何组件的事件处理中使用： confirm({ ... })
 */
export const confirm = (options: ConfirmOptions) => {
  useConfirmStore.getState().show(options)
}

/**
 * 3. 全局挂载组件
 * 这个组件需要放到 layout.tsx 中
 */
export function GlobalConfirmDialog() {
  const { isOpen, options, close, isLoading, setLoading } = useConfirmStore()

  const handleConfirm = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (options.onConfirm) {
      const result = options.onConfirm()
      // 如果返回值是 Promise，则显示 Loading
      if (result instanceof Promise) {
        setLoading(true)
        try {
          await result
          close()
        } catch (error) {
          // 可以在这里处理错误，例如 toast.error
          console.error(error)
        } finally {
          setLoading(false)
        }
      } else {
        close()
      }
    } else {
      close()
    }
  }

  const handleCancel = () => {
    options.onCancel?.()
    close()
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options.title}</AlertDialogTitle>
          {options.description && (
            <AlertDialogDescription asChild>
              <div>{options.description}</div>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel} disabled={isLoading}>
            {options.cancelText || '取消'}
          </AlertDialogCancel>
          <Button
            onClick={handleConfirm}
            disabled={isLoading}
            variant={options.variant === 'destructive' ? 'destructive' : 'default'}
          >
            {isLoading ? '处理中...' : options.confirmText || '确认'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
