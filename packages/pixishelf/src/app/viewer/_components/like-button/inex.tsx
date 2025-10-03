'use client'

import React, { memo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export interface LikeButtonProps {
  liked: boolean
  likeLoading: boolean
  onToggleLike: () => void
  /** 额外的CSS类名 */
  className?: string
}

/**
 * 点赞按钮组件
 *
 * 功能特性：
 * - 集成useLike Hook进行状态管理
 * - 支持乐观更新和防抖
 * - 集成爱心动画效果
 * - 响应式设计，支持多种尺寸和样式
 * - 完整的错误处理和加载状态
 * - 无障碍访问支持
 */
export const LikeButton: React.FC<LikeButtonProps> = ({ className, liked, likeLoading, onToggleLike }) => {
  // 处理点赞点击
  const handleLikeClick = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onToggleLike()
  }, [])

  // 按钮禁用状态
  const isDisabled = likeLoading

  return (
    <>
      <Button
        className={cn(
          'relative transition-all duration-200 ease-in-out',
          'hover:scale-105 active:scale-95',
          'focus-visible:ring-2 focus-visible:ring-red-500/50',
          liked && 'text-red-500',
          isDisabled && 'opacity-50 cursor-not-allowed',
          'w-12 h-12 bg-black/20 hover:bg-black/30 backdrop-blur-sm',
          'rounded-full flex items-center justify-center',
          'transition-all duration-200 hover:scale-105 active:scale-95',
          'shadow-lg',
          className
        )}
        onClick={handleLikeClick}
        disabled={isDisabled}
      >
        {/* 加载状态指示器 */}
        <AnimatePresence mode="wait">
          {likeLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              className="flex items-center justify-center"
            >
              <div
                className="animate-spin rounded-full border-2 border-current border-t-transparent"
                style={{ width: 24, height: 24 }}
              />
            </motion.div>
          ) : (
            <motion.div
              key="heart"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              className="flex items-center"
            >
              {/* 爱心图标 */}
              <motion.div animate={liked ? { scale: [1, 1.2, 1] } : {}} transition={{ duration: 0.3, ease: 'easeOut' }}>
                <Heart
                  size={24}
                  className={cn(
                    'size-6 transition-all duration-200',
                    liked ? 'fill-current text-red-500' : 'text-white hover:text-red-400'
                  )}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 点击波纹效果 */}
        <motion.div
          className="absolute inset-0 rounded-md bg-red-500/20"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 0, opacity: 0 }}
          whileTap={{ scale: 1.5, opacity: [0, 0.3, 0] }}
          transition={{ duration: 0.3 }}
        />
      </Button>
    </>
  )
}

export default memo(LikeButton)
