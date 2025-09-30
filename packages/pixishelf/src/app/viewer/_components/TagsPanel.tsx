'use client'

import React from 'react'
import { X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { Tag } from '@/types'

interface TagsPanelProps {
  tags: Tag[]
  trigger: React.ReactNode
}

/**
 * 全局标签面板组件
 * 使用标准HTML/CSS/JSX和Portal实现底部滑出效果
 */
export default function TagsPanel({ tags, trigger }: TagsPanelProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)
  const [mounted, setMounted] = useState(false)

  // 确保组件在客户端挂载后才渲染Portal
  useEffect(() => {
    setMounted(true)
  }, [])

  // 过滤标签

  // 处理标签点击
  const handleTagClick = useCallback(
    (tagId: number) => {
      router.push(`/tags/${tagId}`)
      handleClose()
    },
    [router]
  )

  // 处理打开
  const handleOpen = useCallback(() => {
    setIsOpen(true)
    // 使用 requestAnimationFrame 确保 DOM 更新后再开始动画
    requestAnimationFrame(() => {
      setIsAnimating(true)
    })
  }, [])

  // 处理关闭
  const handleClose = useCallback(() => {
    setIsAnimating(false)
    // 等待动画完成后再隐藏元素
    setTimeout(() => {
      setIsOpen(false)
    }, 300) // 动画持续时间
  }, [])

  // 处理背景点击
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleClose()
      }
    },
    [handleClose]
  )

  // 处理ESC键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      // 防止背景滚动
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, handleClose])

  // 克隆trigger并添加点击事件
  const triggerElement = React.cloneElement(trigger as any, {
    onClick: handleOpen
  })

  // 按需渲染：只有在打开状态或动画中才渲染Portal内容
  const shouldRender = isOpen || isAnimating

  return (
    <>
      {triggerElement}

      {/* 按需渲染Portal内容 */}
      {mounted &&
        shouldRender &&
        createPortal(
          <div
            className={cn(
              'fixed inset-0 z-[9999] flex items-end justify-center',
              // 背景遮罩动画
              'transition-all duration-300 ease-out',
              isAnimating ? 'bg-black/50' : 'bg-transparent'
            )}
            onClick={handleBackdropClick}
          >
            {/* 底部滑出面板 */}
            <div
              className={cn(
                'w-full bg-white shadow-2xl border-t border-gray-200',
                'h-[80vh] max-h-[600px] rounded-t-xl',
                // 滑入滑出动画
                'transition-transform duration-300 ease-out',
                isAnimating ? 'translate-y-0' : 'translate-y-full'
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col h-full">
                {/* 头部区域 */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white sticky top-0 z-10">
                  <h3 className="text-lg font-semibold text-gray-900">所有标签</h3>
                  <button
                    onClick={handleClose}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                    aria-label="关闭标签面板"
                  >
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>

                {/* 标签列表区域 */}
                <div className="flex-1 overflow-hidden">
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-2">
                      {tags.length ? (
                        tags.map((tag) => (
                          <div
                            key={tag.id}
                            onClick={() => handleTagClick(tag.id)}
                            className="flex flex-col justify-center w-full h-12 rounded text-left px-3 hover:bg-gray-100 transition-colors text-gray-700 hover:text-gray-900"
                          >
                            <div>{tag.name}</div>
                            {!!tag.name_zh && <div className="text-sm text-gray-500">{`${tag.name_zh || ''}`}</div>}
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-8 text-gray-500">暂无标签</div>
                      )}
                    </div>
                  </ScrollArea>
                </div>

                {/* 底部关闭按钮 */}
                <div className="p-4 border-t border-gray-200 bg-white">
                  <button
                    onClick={handleClose}
                    className="w-full py-2 px-4 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors text-gray-700 font-medium text-sm"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
