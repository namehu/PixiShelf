'use client'

import { useEffect, useState } from 'react'

/**
 * 客户端专用 Hook
 * 用于解决 SSR 水合不匹配问题
 * 
 * @returns boolean - 是否在客户端环境
 */
export function useClientOnly(): boolean {
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  return isClient
}

/**
 * 安全的 localStorage Hook
 * 避免 SSR 水合不匹配
 * 
 * @param key - localStorage 键名
 * @param defaultValue - 默认值
 * @returns [value, setValue] - 值和设置函数
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const isClient = useClientOnly()
  
  const [value, setValue] = useState<T>(() => {
    // 服务端渲染时始终返回默认值
    if (!isClient) {
      return defaultValue
    }
    
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : defaultValue
    } catch {
      return defaultValue
    }
  })

  // 客户端水合后，从 localStorage 读取实际值
  useEffect(() => {
    if (!isClient) return

    try {
      const item = localStorage.getItem(key)
      if (item) {
        setValue(JSON.parse(item))
      }
    } catch {
      // 忽略解析错误
    }
  }, [isClient, key])

  const setStoredValue = (newValue: T | ((prev: T) => T)) => {
    try {
      const valueToStore = newValue instanceof Function ? newValue(value) : newValue
      setValue(valueToStore)
      
      if (isClient) {
        localStorage.setItem(key, JSON.stringify(valueToStore))
      }
    } catch {
      // 忽略存储错误
    }
  }

  return [value, setStoredValue]
}

/**
 * 安全的浏览器 API 访问 Hook
 * 
 * @param callback - 需要在客户端执行的回调函数
 * @param deps - 依赖数组
 */
export function useClientEffect(callback: () => void | (() => void), deps?: React.DependencyList) {
  const isClient = useClientOnly()

  useEffect(() => {
    if (isClient) {
      return callback()
    }
  }, [isClient, ...(deps || [])])
}