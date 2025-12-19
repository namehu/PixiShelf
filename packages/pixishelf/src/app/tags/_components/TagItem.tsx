import React, { FC, useMemo } from 'react'
import { motion } from 'framer-motion'
import { getRandomColor, getTranslateName } from '@/utils/tags'
import { Tag } from '@/types'
import { cn } from '@/lib/utils'

interface TagItemProps {
  tag: Tag
  onClick: (tag: Tag) => void
  size?: 'sm' | 'md' | 'lg'
}

export const TagItem: FC<TagItemProps> = ({ tag, onClick, size = 'md' }) => {
  const gradient = useMemo(() => getRandomColor(tag.name), [tag.name])

  const _name = getTranslateName(tag)

  const sizeClasses = {
    sm: 'h-7 px-3 text-xs',
    md: 'h-11 px-4 text-[13px] font-medium',
    lg: 'h-14 px-6 text-base font-bold'
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
      <div className="flex flex-col items-start leading-tight relative z-10 pointer-events-none">
        <span className="tracking-tight line-clamp-1 break-all text-left">{tag.name}</span>
        {size !== 'sm' && _name && (
          <span className="text-[10px] opacity-85 font-normal line-clamp-1 break-all text-left">{_name}</span>
        )}
      </div>
      <span className="relative z-10 text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-mono font-medium min-w-[20px] pointer-events-none self-center">
        {tag.artworkCount}
      </span>
      <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
    </motion.button>
  )
}
