'use client'

import React, { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useSuperLock } from '@/hooks/use-super-lock'
import { Spinner } from '@/components/ui/spinner'

export interface LikeButtonProps {
  liked: boolean
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
export const LikeButton: React.FC<LikeButtonProps> = ({ className, liked, onToggleLike }) => {
  // 处理点赞点击
  const [handleLikeClick, likeLoading] = useSuperLock(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onToggleLike()
  })

  // 按钮禁用状态

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={liked ? '取消喜欢作品' : '喜欢作品'}
      className={cn(
        'relative flex size-12 items-center justify-center rounded-full bg-black/20 text-white shadow-floating backdrop-blur-sm transition-[color,background-color,transform] hover:scale-105 hover:bg-black/30 hover:text-white active:scale-95 motion-reduce:transform-none',
        'focus-visible:ring-2 focus-visible:ring-white/70',
        liked && 'text-destructive hover:text-destructive',
        likeLoading && 'cursor-not-allowed opacity-50',
        className
      )}
      onClick={handleLikeClick}
      disabled={likeLoading}
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
            <Spinner className="size-5" aria-label={liked ? '正在取消喜欢' : '正在添加喜欢'} />
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
                aria-hidden="true"
                className={cn(
                  'size-6 transition-[color,fill] duration-(--motion-fast)',
                  liked ? 'fill-current text-destructive' : 'text-white hover:text-destructive'
                )}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 点击波纹效果 */}
      <motion.div
        className="absolute inset-0 rounded-full bg-destructive/20"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 0, opacity: 0 }}
        whileTap={{ scale: 1.5, opacity: [0, 0.3, 0] }}
        transition={{ duration: 0.3 }}
      />
    </Button>
  )
}

export default memo(LikeButton)
