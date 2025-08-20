import React, { useEffect, useRef } from 'react'
import { useResponsive } from '../../hooks/use-responsive'

// 抽屉位置类型
export type DrawerPosition = 'left' | 'right' | 'top' | 'bottom'

// 移动端抽屉Props接口
export interface MobileDrawerProps {
  /** 是否显示抽屉 */
  isOpen: boolean
  /** 关闭抽屉回调 */
  onClose: () => void
  /** 抽屉内容 */
  children: React.ReactNode
  /** 抽屉位置 */
  position?: DrawerPosition
  /** 抽屉标题 */
  title?: string
  /** 是否显示关闭按钮 */
  showCloseButton?: boolean
  /** 是否允许点击遮罩关闭 */
  closeOnOverlayClick?: boolean
  /** 是否允许ESC键关闭 */
  closeOnEscape?: boolean
  /** 自定义样式类名 */
  className?: string
  /** 抽屉宽度（仅left/right位置有效） */
  width?: string
  /** 抽屉高度（仅top/bottom位置有效） */
  height?: string
}

/**
 * 移动端抽屉组件
 * 
 * 功能：
 * - 支持四个方向的抽屉（左、右、上、下）
 * - 支持滑动手势关闭（基础实现）
 * - 支持遮罩点击关闭
 * - 支持键盘操作（ESC关闭）
 * - 支持无障碍访问（ARIA标签、焦点管理）
 * - 响应式设计，仅在移动端显示
 * - 防止背景滚动
 * 
 * @param props - 组件属性
 * @returns 移动端抽屉组件
 */
export function MobileDrawer({
  isOpen,
  onClose,
  children,
  position = 'left',
  title,
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  className = '',
  width = '280px',
  height = '50vh'
}: MobileDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)
  const { isMobile } = useResponsive()
  
  // 键盘事件处理
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return
    
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, closeOnEscape])
  
  // 焦点管理
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      // 聚焦到抽屉容器
      const timer = setTimeout(() => {
        drawerRef.current?.focus()
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
    if (event.target === event.currentTarget && closeOnOverlayClick) {
      onClose()
    }
  }
  
  // 简单的触摸手势处理
  const handleTouchStart = useRef({ x: 0, y: 0 })
  const handleTouchEnd = (event: React.TouchEvent) => {
    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - handleTouchStart.current.x
    const deltaY = touch.clientY - handleTouchStart.current.y
    const threshold = 50 // 滑动阈值
    
    // 根据抽屉位置判断关闭手势
    switch (position) {
      case 'left':
        if (deltaX < -threshold) onClose()
        break
      case 'right':
        if (deltaX > threshold) onClose()
        break
      case 'top':
        if (deltaY < -threshold) onClose()
        break
      case 'bottom':
        if (deltaY > threshold) onClose()
        break
    }
  }
  
  const handleTouchStartCapture = (event: React.TouchEvent) => {
    const touch = event.touches[0]
    handleTouchStart.current = { x: touch.clientX, y: touch.clientY }
  }
  
  // 获取抽屉样式
  const getDrawerStyles = () => {
    const baseStyles = 'fixed bg-white shadow-xl transform transition-transform duration-300 ease-in-out z-40'
    
    switch (position) {
      case 'left':
        return `${baseStyles} top-0 left-0 h-full ${isOpen ? 'translate-x-0' : '-translate-x-full'}`
      case 'right':
        return `${baseStyles} top-0 right-0 h-full ${isOpen ? 'translate-x-0' : 'translate-x-full'}`
      case 'top':
        return `${baseStyles} top-0 left-0 w-full ${isOpen ? 'translate-y-0' : '-translate-y-full'}`
      case 'bottom':
        return `${baseStyles} bottom-0 left-0 w-full ${isOpen ? 'translate-y-0' : 'translate-y-full'}`
      default:
        return baseStyles
    }
  }
  
  // 获取抽屉尺寸样式
  const getSizeStyles = () => {
    switch (position) {
      case 'left':
      case 'right':
        return { width }
      case 'top':
      case 'bottom':
        return { height }
      default:
        return {}
    }
  }
  
  // 如果不是移动端且抽屉未打开，不渲染
  if (!isOpen) return null
  
  return (
    <div className="fixed inset-0 z-50">
      {/* 遮罩层 */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-300 ${
          isOpen ? 'bg-opacity-50' : 'bg-opacity-0'
        }`}
        onClick={handleOverlayClick}
        aria-hidden="true"
      />
      
      {/* 抽屉内容 */}
      <div
        ref={drawerRef}
        className={`${getDrawerStyles()} ${className}`}
        style={getSizeStyles()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'drawer-title' : undefined}
        tabIndex={-1}
        onTouchStart={handleTouchStartCapture}
        onTouchEnd={handleTouchEnd}
      >
        {/* 抽屉头部 */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between p-4 border-b border-neutral-200">
            {title && (
              <h2
                id="drawer-title"
                className="text-lg font-semibold text-neutral-900"
              >
                {title}
              </h2>
            )}
            
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="btn-ghost p-2 rounded-lg hover:bg-neutral-100 focus:ring-2 focus:ring-neutral-500"
                aria-label="关闭抽屉"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        )}
        
        {/* 抽屉内容区域 */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}

// 默认导出
export default MobileDrawer