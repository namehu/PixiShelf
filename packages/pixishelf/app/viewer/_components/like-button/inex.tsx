'use client'

import React, { memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Heart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

export interface LikeButtonProps {
  liked: boolean
  onToggleLike: () => void
  disabled?: boolean
  saving?: boolean
  label?: string
  /** 额外的CSS类名 */
  className?: string
}

/** The shared rating queue owns pending writes; subsequent heart clicks remain usable. */
export const LikeButton: React.FC<LikeButtonProps> = ({ className, liked, onToggleLike, disabled, saving, label }) => {
  const handleLikeClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onToggleLike()
  }
  const accessibleLabel = label ?? (liked ? '取消喜欢并清除评分' : '喜欢作品')

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      aria-pressed={liked}
      aria-busy={saving || undefined}
      className={cn(
        'relative flex size-12 items-center justify-center rounded-full bg-black/20 text-white shadow-floating backdrop-blur-sm transition-[color,background-color,transform] hover:scale-105 hover:bg-black/30 hover:text-white active:scale-95 motion-reduce:transform-none',
        'focus-visible:ring-2 focus-visible:ring-white/70',
        liked && 'text-destructive hover:text-destructive',
        className
      )}
      onClick={handleLikeClick}
      disabled={disabled}
    >
      {/* 加载状态指示器 */}
      <AnimatePresence mode="wait">
        {saving ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="flex items-center justify-center"
          >
            <Spinner className="size-5" aria-label="正在保存评分" />
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
