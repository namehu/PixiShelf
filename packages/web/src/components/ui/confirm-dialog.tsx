import React, { useEffect, useRef } from 'react'

// 确认弹窗Props接口
export interface ConfirmDialogProps {
  /** 是否显示弹窗 */
  isOpen: boolean
  /** 关闭弹窗回调 */
  onClose: () => void
  /** 确认操作回调 */
  onConfirm: () => void
  /** 弹窗标题 */
  title: string
  /** 弹窗消息内容 */
  message: string
  /** 确认按钮文案 */
  confirmText?: string
  /** 取消按钮文案 */
  cancelText?: string
  /** 确认按钮样式类型 */
  confirmVariant?: 'primary' | 'danger'
  /** 是否显示加载状态 */
  isLoading?: boolean
}

/**
 * 确认弹窗组件
 * 
 * 功能：
 * - 支持自定义标题、内容和按钮文案
 * - 支持键盘操作（ESC关闭，Enter确认）
 * - 支持无障碍访问（ARIA标签、焦点管理）
 * - 支持不同的确认按钮样式（主要、危险）
 * - 支持加载状态显示
 * - 点击遮罩关闭
 * 
 * @param props - 组件属性
 * @returns 确认弹窗组件
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  confirmVariant = 'primary',
  isLoading = false
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  
  // 键盘事件处理
  useEffect(() => {
    if (!isOpen) return
    
    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'Escape':
          if (!isLoading) {
            onClose()
          }
          break
        case 'Enter':
          if (!isLoading) {
            onConfirm()
          }
          break
      }
    }
    
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, onConfirm, isLoading])
  
  // 焦点管理
  useEffect(() => {
    if (isOpen && confirmButtonRef.current) {
      // 延迟聚焦，确保DOM已渲染
      const timer = setTimeout(() => {
        confirmButtonRef.current?.focus()
      }, 100)
      
      return () => clearTimeout(timer)
    }
  }, [isOpen])
  
  // 阻止body滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = 'unset'
      }
    }
  }, [isOpen])
  
  // 处理遮罩点击
  const handleOverlayClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget && !isLoading) {
      onClose()
    }
  }
  
  // 确认按钮样式
  const confirmButtonClass = confirmVariant === 'danger'
    ? 'bg-error-600 text-white hover:bg-error-700 focus:ring-error-500'
    : 'bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500'
  
  if (!isOpen) return null
  
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-description"
    >
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={handleOverlayClick}
        aria-hidden="true"
      />
      
      {/* 弹窗内容 */}
      <div
        ref={dialogRef}
        className="relative w-full max-w-md transform rounded-2xl bg-white p-6 shadow-xl transition-all"
      >
        {/* 标题 */}
        <div className="mb-4">
          <h3
            id="dialog-title"
            className="text-lg font-semibold text-neutral-900"
          >
            {title}
          </h3>
        </div>
        
        {/* 消息内容 */}
        <div className="mb-6">
          <p
            id="dialog-description"
            className="text-sm text-neutral-600 leading-relaxed"
          >
            {message}
          </p>
        </div>
        
        {/* 按钮组 */}
        <div className="flex gap-3 justify-end">
          {/* 取消按钮 */}
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="btn btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          
          {/* 确认按钮 */}
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`btn ${confirmButtonClass} disabled:opacity-50 disabled:cursor-not-allowed min-w-[80px] flex items-center justify-center`}
          >
            {isLoading ? (
              <>
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                处理中...
              </>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// 默认导出
export default ConfirmDialog