import React from 'react'
import { motion } from 'framer-motion'
import { getRandomColor } from '@/utils/tags'
import { Tag } from '@/types'
import { cn } from '@/lib/utils'

interface TagItemProps {
  tag: Tag
  onClick: (tag: Tag) => void
  size?: 'sm' | 'md' | 'lg'
}

export const TagItem: React.FC<TagItemProps> = ({ tag, onClick, size = 'md' }) => {
  // 使用 tag.id 作为种子，确保颜色在滚动和克隆时保持静止
  const gradient = React.useMemo(() => getRandomColor(tag.name), [tag.name])

  const sizeClasses = {
    sm: 'px-3 py-1 text-xs',
    md: 'px-4 py-2 text-[13px] font-medium',
    lg: 'px-6 py-3 text-base font-bold'
  }

  return (
    <motion.button
      // 优化动画参数：stiffness 增加刚性减少延迟，damping 减少震荡
      whileHover={{
        scale: 1.05,
        y: -2,
        boxShadow: '0 10px 20px -5px rgba(0,0,0,0.1)'
      }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 25,
        mass: 1
      }}
      whileTap={{ scale: 0.96 }}
      onClick={() => onClick(tag)}
      className={cn(
        'relative group flex items-center gap-2 overflow-hidden rounded-full transition-shadow duration-300',
        'bg-gradient-to-br border border-white/40 backdrop-blur-sm',
        // 开启强制 GPU 加速，解决字体抖动
        'transform-gpu backface-hidden antialiased will-change-transform',
        gradient,
        sizeClasses[size],
        'text-white'
      )}
      style={{
        WebkitFontSmoothing: 'antialiased',
        transform: 'translateZ(0)'
      }}
    >
      <span className="relative z-10 tracking-tight pointer-events-none">{tag.name}</span>
      <span className="relative z-10 text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-mono font-medium min-w-[20px] pointer-events-none">
        {tag.artworkCount}
      </span>
      <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
    </motion.button>
  )
}
