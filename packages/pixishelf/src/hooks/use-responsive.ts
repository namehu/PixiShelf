'use client'

import { useState, useEffect, useCallback } from 'react'

// 响应式断点定义（与Tailwind CSS保持一致）
const BREAKPOINTS = {
  sm: 640,   // 小屏幕
  md: 768,   // 中等屏幕（平板）
  lg: 1024,  // 大屏幕（桌面）
  xl: 1280,  // 超大屏幕
  '2xl': 1536 // 超超大屏幕
} as const

// Hook返回类型
export interface UseResponsiveReturn {
  // 当前窗口尺寸
  windowSize: {
    width: number
    height: number
  }
  // 断点检测
  isMobile: boolean    // < 768px
  isTablet: boolean    // >= 768px && < 1024px
  isDesktop: boolean   // >= 1024px
  // 具体断点
  isSmUp: boolean      // >= 640px
  isMdUp: boolean      // >= 768px
  isLgUp: boolean      // >= 1024px
  isXlUp: boolean      // >= 1280px
  is2XlUp: boolean     // >= 1536px
}

/**
 * 响应式断点检测Hook
 * 
 * 功能：
 * - 实时检测窗口尺寸变化
 * - 提供常用的响应式断点判断
 * - 与Tailwind CSS断点系统保持一致
 * - 防抖处理，避免频繁更新
 * 
 * @returns {UseResponsiveReturn} 响应式状态信息
 */
export function useResponsive(): UseResponsiveReturn {
  // 窗口尺寸状态
  const [windowSize, setWindowSize] = useState({
    width: 0,
    height: 0
  })
  
  // 获取当前窗口尺寸
  const getWindowSize = useCallback(() => {
    return {
      width: window.innerWidth,
      height: window.innerHeight
    }
  }, [])
  
  // 防抖处理的resize处理函数
  const handleResize = useCallback(() => {
    const newSize = getWindowSize()
    setWindowSize(newSize)
  }, [getWindowSize])
  
  // 设置resize监听器
  useEffect(() => {
    // 初始化窗口尺寸
    handleResize()
    
    // 防抖处理
    let timeoutId: NodeJS.Timeout
    
    const debouncedResize = () => {
      clearTimeout(timeoutId)
      timeoutId = setTimeout(handleResize, 100) // 100ms防抖
    }
    
    // 添加事件监听器
    window.addEventListener('resize', debouncedResize)
    
    // 清理函数
    return () => {
      window.removeEventListener('resize', debouncedResize)
      clearTimeout(timeoutId)
    }
  }, [handleResize])
  
  // 计算响应式状态
  const responsiveState = {
    windowSize,
    
    // 主要断点
    isMobile: windowSize.width < BREAKPOINTS.md,
    isTablet: windowSize.width >= BREAKPOINTS.md && windowSize.width < BREAKPOINTS.lg,
    isDesktop: windowSize.width >= BREAKPOINTS.lg,
    
    // 具体断点
    isSmUp: windowSize.width >= BREAKPOINTS.sm,
    isMdUp: windowSize.width >= BREAKPOINTS.md,
    isLgUp: windowSize.width >= BREAKPOINTS.lg,
    isXlUp: windowSize.width >= BREAKPOINTS.xl,
    is2XlUp: windowSize.width >= BREAKPOINTS['2xl']
  }
  
  return responsiveState
}

// 导出断点常量供其他组件使用
export { BREAKPOINTS }

// 工具函数：检查是否为移动端
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth < BREAKPOINTS.md
}

// 工具函数：检查是否为桌面端
export function isDesktopDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.innerWidth >= BREAKPOINTS.lg
}

// 工具函数：获取当前断点名称
export function getCurrentBreakpoint(): keyof typeof BREAKPOINTS | 'xs' {
  if (typeof window === 'undefined') return 'xs'
  
  const width = window.innerWidth
  
  if (width >= BREAKPOINTS['2xl']) return '2xl'
  if (width >= BREAKPOINTS.xl) return 'xl'
  if (width >= BREAKPOINTS.lg) return 'lg'
  if (width >= BREAKPOINTS.md) return 'md'
  if (width >= BREAKPOINTS.sm) return 'sm'
  
  return 'xs'
}