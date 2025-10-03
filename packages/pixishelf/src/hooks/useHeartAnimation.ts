'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  HeartAnimationData,
  HeartAnimationConfig,
  Point,
  RapidClickDetector,
  LongPressDetector,
  generateMultipleHearts,
  getRelativePosition,
  DEFAULT_HEART_CONFIG,
  DEFAULT_RAPID_CLICK_CONFIG,
  DEFAULT_LONG_PRESS_CONFIG
} from '@/utils/heartAnimation'

export interface UseHeartAnimationOptions {
  /** 爱心动画配置 */
  heartConfig?: Partial<HeartAnimationConfig>
  /** 快速点击配置 */
  rapidClickConfig?: {
    threshold?: number
    timeWindow?: number
  }
  /** 长按配置 */
  longPressConfig?: {
    threshold?: number
  }
  /** 最大同时动画数量 */
  maxConcurrentAnimations?: number
  /** 是否启用爱心动画 */
  enabled?: boolean
}

export interface UseHeartAnimationReturn {
  /** 当前活跃的爱心动画数据 */
  activeHearts: HeartAnimationData[]
  /** 触发爱心动画 */
  triggerHearts: (position: Point, count?: number) => void
  /** 处理鼠标按下事件 */
  handleMouseDown: (event: React.MouseEvent<HTMLElement>) => void
  /** 处理鼠标抬起事件 */
  handleMouseUp: (event: React.MouseEvent<HTMLElement>) => void
  /** 处理触摸开始事件 */
  handleTouchStart: (event: React.TouchEvent<HTMLElement>) => void
  /** 处理触摸结束事件 */
  handleTouchEnd: (event: React.TouchEvent<HTMLElement>) => void
  /** 处理点击事件 */
  handleClick: (event: React.MouseEvent<HTMLElement>) => void
  /** 清除所有动画 */
  clearAllHearts: () => void
  /** 当前点击次数 */
  clickCount: number
  /** 是否正在长按 */
  isLongPressing: boolean
}

/**
 * 爱心动画管理 Hook
 * 提供完整的爱心动画状态管理和事件处理
 * 优化版本：改进内存管理、减少重新渲染、优化事件处理
 */
export function useHeartAnimation(options: UseHeartAnimationOptions = {}): UseHeartAnimationReturn {
  const {
    enabled = true,
    heartConfig,
    rapidClickConfig = {},
    longPressConfig = {},
    maxConcurrentAnimations = 15 // 降低默认并发数量以提升性能
  } = options

  // 使用 useMemo 缓存配置对象，避免每次渲染都重新创建
  const finalHeartConfig: HeartAnimationConfig = useMemo(
    () => ({
      ...DEFAULT_HEART_CONFIG,
      ...heartConfig
    }),
    [heartConfig]
  )

  const finalRapidClickConfig = useMemo(
    () => ({
      ...DEFAULT_RAPID_CLICK_CONFIG,
      ...rapidClickConfig
    }),
    [rapidClickConfig]
  )

  const finalLongPressConfig = useMemo(
    () => ({
      ...DEFAULT_LONG_PRESS_CONFIG,
      ...longPressConfig
    }),
    [longPressConfig]
  )

  // 状态管理
  const [activeHearts, setActiveHearts] = useState<HeartAnimationData[]>([])
  const [clickCount, setClickCount] = useState(0)
  const [isLongPressing, setIsLongPressing] = useState(false)

  // 检测器实例和引用
  const rapidClickDetectorRef = useRef<RapidClickDetector | null>(null)
  const longPressDetectorRef = useRef<LongPressDetector | null>(null)
  const containerRef = useRef<HTMLElement | null>(null)

  // 性能优化：使用 ref 存储清理函数，避免重复创建
  const cleanupTimersRef = useRef<Set<NodeJS.Timeout>>(new Set())
  const animationFrameRef = useRef<number | null>(null)

  // 初始化检测器 - 优化依赖数组
  useEffect(() => {
    rapidClickDetectorRef.current = new RapidClickDetector(
      finalRapidClickConfig.threshold,
      finalRapidClickConfig.timeWindow
    )
    longPressDetectorRef.current = new LongPressDetector(finalLongPressConfig.threshold)

    return () => {
      // 清理检测器
      longPressDetectorRef.current?.clearDetection()
      rapidClickDetectorRef.current?.reset()

      // 清理所有定时器
      cleanupTimersRef.current.forEach((timer) => clearTimeout(timer))
      cleanupTimersRef.current.clear()

      // 清理动画帧
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [finalRapidClickConfig.threshold, finalRapidClickConfig.timeWindow, finalLongPressConfig.threshold])

  // 优化：使用 requestAnimationFrame 批量更新点击次数
  const updateClickCount = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      if (rapidClickDetectorRef.current) {
        const newCount = rapidClickDetectorRef.current.getClickCount()
        setClickCount((prev) => (prev !== newCount ? newCount : prev))
      }
    })
  }, [])

  /**
   * 优化的移除爱心函数 - 使用批量更新
   */
  const removeHeart = useCallback((id: string) => {
    setActiveHearts((prev) => {
      const filtered = prev.filter((heart) => heart.id !== id)
      // 只有在实际有变化时才更新状态
      return filtered.length !== prev.length ? filtered : prev
    })
  }, [])

  /**
   * 优化的触发爱心动画函数
   */
  const triggerHearts = useCallback(
    (position: Point, count: number = 3) => {
      if (!enabled) return

      // 限制爱心数量以提升性能
      const actualCount = Math.min(count, 8)
      const newHearts = generateMultipleHearts(position, finalHeartConfig, actualCount)

      setActiveHearts((prev) => {
        const updated = [...prev, ...newHearts]
        // 优化：使用更高效的数组切片
        if (updated.length > maxConcurrentAnimations) {
          return updated.slice(-maxConcurrentAnimations)
        }
        return updated
      })

      // 为每个新爱心设置自动清理定时器
      newHearts.forEach((heart) => {
        const timer = setTimeout(
          () => {
            removeHeart(heart.id)
            cleanupTimersRef.current.delete(timer)
          },
          heart.duration + heart.delay + 100
        ) // 额外100ms缓冲

        cleanupTimersRef.current.add(timer)
      })
    },
    [enabled, finalHeartConfig, maxConcurrentAnimations, removeHeart]
  )

  /**
   * 清除所有动画 - 优化清理逻辑
   */
  const clearAllHearts = useCallback(() => {
    setActiveHearts([])
    rapidClickDetectorRef.current?.reset()
    setClickCount(0)

    // 清理所有定时器
    cleanupTimersRef.current.forEach((timer) => clearTimeout(timer))
    cleanupTimersRef.current.clear()
  }, [])

  /**
   * 优化的快速点击处理
   */
  const handleRapidClick = useCallback(
    (event: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) => {
      if (!enabled) return

      // 使用视口坐标，不传递容器参数
      const position = getRelativePosition(event.nativeEvent)
      const isRapid = rapidClickDetectorRef.current?.detectRapidClick()

      if (isRapid) {
        triggerHearts(position, 5) // 快速点击触发更多爱心
      }

      updateClickCount()
    },
    [enabled, triggerHearts, updateClickCount]
  )

  /**
   * 长按处理函数 - 使用 useCallback 优化
   */
  const handleLongPressStart = useCallback(() => {
    setIsLongPressing(true)
  }, [])

  const handleLongPressEnd = useCallback(() => {
    setIsLongPressing(false)
    longPressDetectorRef.current?.clearDetection()
  }, [])

  /**
   * 优化的事件处理函数
   */
  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!enabled) return

      containerRef.current = event.currentTarget
      longPressDetectorRef.current?.startDetection(handleLongPressStart)
    },
    [enabled, handleLongPressStart]
  )

  const handleMouseUp = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!enabled) return

      handleLongPressEnd()

      // 如果不是长按，则处理快速点击
      if (!isLongPressing) {
        handleRapidClick(event)
      }
    },
    [enabled, handleLongPressEnd, isLongPressing, handleRapidClick]
  )

  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      if (!enabled) return

      containerRef.current = event.currentTarget
      longPressDetectorRef.current?.startDetection(handleLongPressStart)
    },
    [enabled, handleLongPressStart]
  )

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      if (!enabled) return

      handleLongPressEnd()

      // 如果不是长按，则处理快速点击
      if (!isLongPressing) {
        handleRapidClick(event)
      }
    },
    [enabled, handleLongPressEnd, isLongPressing, handleRapidClick]
  )

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!enabled) return

      containerRef.current = event.currentTarget
    },
    [enabled]
  )

  // 优化：使用 useMemo 缓存返回的 activeHearts，避免每次都重新映射
  const optimizedActiveHearts = useMemo(
    () =>
      activeHearts.map((heart) => ({
        ...heart,
        onComplete: removeHeart
      })) as HeartAnimationData[],
    [activeHearts, removeHeart]
  )

  return {
    activeHearts: optimizedActiveHearts,
    triggerHearts,
    handleMouseDown,
    handleMouseUp,
    handleTouchStart,
    handleTouchEnd,
    handleClick,
    clearAllHearts,
    clickCount,
    isLongPressing
  }
}
