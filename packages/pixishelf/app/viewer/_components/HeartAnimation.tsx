'use client'

import React, { useEffect, memo, useMemo } from 'react'
import { motion } from 'framer-motion'
import { HeartIcon } from 'lucide-react'
import type { HeartAnimationData } from '@/utils/heartAnimation'

export interface HeartAnimationProps {
  /** 爱心动画数据 */
  data: HeartAnimationData
  /** 动画完成回调 */
  onComplete?: (id: string) => void
  /** 容器类名 */
  className?: string
}

/**
 * 单个爱心动画组件
 * 使用 framer-motion 实现移动、缩放、透明度动画
 * 优化版本：GPU 加速、减少重新渲染、内存管理优化
 */
export const HeartAnimation: React.FC<HeartAnimationProps> = memo(({ data, onComplete, className = '' }) => {
  const { id, startPosition, endPosition, size, color, duration, delay } = data

  // 动画完成后清理 - 优化定时器管理
  useEffect(() => {
    const timer = setTimeout(() => {
      onComplete?.(id)
    }, duration + delay)

    return () => clearTimeout(timer)
  }, [id, duration, delay, onComplete])

  // 使用 useMemo 缓存动画变体，避免每次渲染都重新创建
  const variants = useMemo(
    () => ({
      initial: {
        x: startPosition.x,
        y: startPosition.y,
        scale: 0,
        opacity: 0,
        // GPU 加速优化
        willChange: 'transform, opacity'
      },
      animate: {
        x: endPosition.x,
        y: endPosition.y,
        scale: [0, 1.2, 1, 0.8, 0],
        opacity: [0, 1, 1, 0.8, 0],
        // GPU 加速优化
        willChange: 'transform, opacity'
      }
    }),
    [startPosition.x, startPosition.y, endPosition.x, endPosition.y]
  )

  // 使用 useMemo 缓存动画配置，避免每次渲染都重新创建
  const transition = useMemo(
    () => ({
      duration: duration / 1000, // 转换为秒
      delay: delay / 1000, // 转换为秒
      ease: [0.25, 0.46, 0.45, 0.94], // 自定义缓动函数
      scale: {
        times: [0, 0.2, 0.5, 0.8, 1],
        ease: 'easeOut'
      },
      opacity: {
        times: [0, 0.2, 0.6, 0.9, 1],
        ease: 'easeInOut'
      }
    }),
    [duration, delay]
  )

  // 使用 useMemo 缓存样式对象
  const containerStyle = useMemo(
    () => ({
      left: 0,
      top: 0,
      transformOrigin: 'center center',
      // GPU 加速优化
      transform: 'translateZ(0)',
      backfaceVisibility: 'hidden' as const,
      perspective: 1000
    }),
    []
  )

  // 使用 useMemo 缓存 HeartIcon 的样式
  const heartIconStyle = useMemo(
    () => ({
      filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
      transform: 'translate(-50%, -50%)',
      // GPU 加速优化
      willChange: 'transform'
    }),
    []
  )

  return (
    <motion.div
      className={`heart-animation absolute pointer-events-none z-50 ${className}`}
      style={containerStyle}
      variants={variants}
      initial="initial"
      animate="animate"
      transition={transition}
      // 性能优化：减少布局重排
      layout={false}
      // 优化：当动画完成时自动移除
      onAnimationComplete={() => {
        // 额外的安全检查，确保组件被清理
        setTimeout(() => onComplete?.(id), 50)
      }}
    >
      <HeartIcon size={size} color={color} fill={color} strokeWidth={0} style={heartIconStyle} />
    </motion.div>
  )
})

export default HeartAnimation
