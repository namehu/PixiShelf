import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

// Toast类型定义
export type ToastType = 'success' | 'error' | 'loading' | 'none'

export interface Toast {
  id: string
  type: ToastType
  title: string
  duration?: number
  mask?: boolean // 是否显示透明蒙层防止触摸穿透
}

// Toast Context
interface ToastContextType {
  showToast: (options: Omit<Toast, 'id'>) => void
  hideToast: () => void
}

const ToastContext = createContext<ToastContextType | null>(null)

// Toast Provider
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [currentToast, setCurrentToast] = useState<Toast | null>(null)
  const [isVisible, setIsVisible] = useState(false)

  const showToast = useCallback((options: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substr(2, 9)
    const newToast = { ...options, id }
    setCurrentToast(newToast)
    setIsVisible(true)

    // 自动隐藏toast（除非是loading类型）
    if (options.type !== 'loading') {
      const duration = options.duration || 1500
      setTimeout(() => {
        hideToast()
      }, duration)
    }
  }, [])

  const hideToast = useCallback(() => {
    setIsVisible(false)
    setTimeout(() => {
      setCurrentToast(null)
    }, 300)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {currentToast && <ToastContainer toast={currentToast} isVisible={isVisible} onHide={hideToast} />}
    </ToastContext.Provider>
  )
}

// Toast Hook
export function useToastContext() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

// Toast Container
interface ToastContainerProps {
  toast: Toast
  isVisible: boolean
  onHide: () => void
}

function ToastContainer({ toast, isVisible, onHide }: ToastContainerProps) {
  // 键盘事件处理（ESC关闭）
  useEffect(() => {
    if (!isVisible) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && toast.type !== 'loading') {
        onHide()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isVisible, onHide, toast.type])

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return (
          <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        )
      case 'error':
        return (
          <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
        )
      case 'loading':
        return <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
      case 'none':
      default:
        return null
    }
  }

  const getToastStyles = () => {
    const baseStyles =
      'fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 transition-all duration-300'
    const visibilityStyles = isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
    return `${baseStyles} ${visibilityStyles}`
  }

  return (
    <>
      {/* 蒙层 */}
      {toast.mask && (
        <div
          className={`fixed inset-0 z-40 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.1)' }}
        />
      )}

      {/* Toast内容 */}
      <div className={getToastStyles()}>
        <div className="bg-black bg-opacity-80 text-white rounded-lg px-6 py-4 max-w-xs min-w-[120px] text-center">
          {/* 图标 */}
          {getIcon() && <div className="flex justify-center mb-2">{getIcon()}</div>}

          {/* 标题 */}
          <div className="text-sm font-medium leading-relaxed">{toast.title}</div>
        </div>
      </div>
    </>
  )
}

// 便捷Hook方法
export function useToast() {
  const { showToast, hideToast } = useToastContext()

  return [
    {
      success: (title: string, options?: Partial<Omit<Toast, 'id' | 'type' | 'title'>>) => {
        showToast({ type: 'success', title, ...options })
      },
      error: (title: string, options?: Partial<Omit<Toast, 'id' | 'type' | 'title'>>) => {
        showToast({ type: 'error', title, ...options })
      },
      loading: (title: string = '加载中...', options?: Partial<Omit<Toast, 'id' | 'type' | 'title'>>) => {
        showToast({ type: 'loading', title, mask: true, ...options })
      },
      show: (title: string, options?: Partial<Omit<Toast, 'id' | 'type' | 'title'>>) => {
        showToast({ type: 'none', title, ...options })
      },
      hide: hideToast
    }
  ] as const
}
