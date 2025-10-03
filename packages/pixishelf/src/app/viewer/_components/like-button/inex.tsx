'use client'

import React, { memo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLike } from './useLike'
import { Button } from '@/components/ui/button'

export interface LikeButtonProps {
  /** 作品ID */
  artworkId: number
  /** 是否启用乐观更新 */
  optimistic?: boolean
  /** 防抖延迟（毫秒） */
  debounceMs?: number
  /** 额外的CSS类名 */
  className?: string
  /** 点赞成功回调 */
  onLikeSuccess?: (liked: boolean, likeCount: number) => void
  /** 错误回调 */
  onError?: (error: Error) => void
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
export const LikeButton: React.FC<LikeButtonProps> = ({
  artworkId,
  optimistic = true,
  debounceMs = 300,
  className,
  onLikeSuccess,
  onError
}) => {
  // 使用点赞Hook
  const { liked, isLoading, isToggling, toggleLike } = useLike({
    artworkId,
    optimistic,
    debounceMs,
    onSuccess: onLikeSuccess ? (liked) => onLikeSuccess(liked, 0) : undefined,
    onError
  })

  // 处理点赞点击
  const handleLikeClick = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()

      // 如果正在切换状态，忽略点击
      if (isToggling) return

      // 执行点赞切换
      await toggleLike()
    },
    [isToggling, liked, toggleLike]
  )

  // 计算图标尺寸
  const iconSize = 24

  // 按钮禁用状态
  const isDisabled = isLoading || isToggling

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
          {isToggling ? (
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
                style={{ width: iconSize, height: iconSize }}
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
