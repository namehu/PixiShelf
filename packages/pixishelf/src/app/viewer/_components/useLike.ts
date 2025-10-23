'use client'

import { useSuperLock } from '@/hooks/useSuperLock'
import { useState, useCallback, useRef, useEffect } from 'react'
import { toast } from 'sonner'

// ============================================================================
// 类型定义
// ============================================================================

export interface LikeStatus {
  likeCount: number
  userLiked: boolean
}

export interface UseLikeOptions {
  /** 作品ID */
  artworkId: number
  /** 防抖延迟（毫秒） */
  debounceMs?: number
  /** 错误回调 */
  onError?: (error: Error) => void
  /** 成功回调 */
  onSuccess?: (status: boolean) => void
}

// ============================================================================
// API 调用函数
// ============================================================================

/**
 * 获取点赞状态
 */
async function fetchLikeStatus(artworkId: number): Promise<LikeStatus> {
  const response = await fetch(`/api/artworks/${artworkId}/like`)

  if (!response.ok) {
    throw new Error(`获取点赞状态失败: ${response.status}`)
  }

  const result = await response.json()

  if (!result.success) {
    throw new Error(result.error || '获取点赞状态失败')
  }

  return result.data
}

/**
 * 切换点赞状态
 */
async function toggleLikeStatus(artworkId: number): Promise<LikeStatus> {
  const response = await fetch(`/api/artworks/${artworkId}/like`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`切换点赞状态失败: ${response.status}`)
  }

  const result = await response.json()

  if (!result.success) {
    throw new Error(result.error || '切换点赞状态失败')
  }

  return {
    likeCount: result.data.likeCount,
    userLiked: result.data.userLiked
  }
}

// ============================================================================
// useLike Hook
// ============================================================================

/**
 * 点赞功能 Hook
 * 提供点赞状态管理、乐观更新、防抖和错误处理
 */
export function useLike(artworkId: number) {
  // 状态管理
  const [liked, setLiked] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // 引用管理
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 添加防重复调用的 ref
  const isRefreshingRef = useRef(false)
  const lastFetchedArtworkIdRef = useRef<number | null>(null)

  /**
   * 刷新点赞状态
   */
  const refreshStatus = async (artworkId: number) => {
    // 防止重复调用
    if (isRefreshingRef.current) {
      console.log('refreshStatus already in progress, skipping...')
      return
    }

    // 如果已经获取过相同的 artworkId，跳过
    if (lastFetchedArtworkIdRef.current === artworkId) {
      return
    }

    isRefreshingRef.current = true
    setIsLoading(true)

    try {
      const newStatus = await fetchLikeStatus(artworkId)
      setLiked(newStatus.userLiked)
      lastFetchedArtworkIdRef.current = artworkId
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        toast.error(err.message)
      }
    } finally {
      setIsLoading(false)
      isRefreshingRef.current = false
    }
  }

  /**
   * 切换点赞状态
   */
  const [toggleLike, isToggling] = useSuperLock(async () => {
    try {
      const newStatus = await toggleLikeStatus(artworkId)
      setLiked(newStatus.userLiked)
    } catch (err: any) {
      toast.error(err.message)
    }
  })

  /**
   * 初始化时获取点赞状态
   */
  useEffect(() => {
    refreshStatus(artworkId)
  }, []) // 只在 artworkId 变化时重新获取

  /**
   * 清理副作用
   */
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
    }
  }, [])

  return {
    liked,
    isLoading,
    isToggling,
    toggleLike
  }
}
