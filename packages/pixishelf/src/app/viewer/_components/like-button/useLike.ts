'use client'

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
  /** 初始点赞状态 */
  initialStatus?: LikeStatus
  /** 是否启用乐观更新 */
  optimistic?: boolean
  /** 防抖延迟（毫秒） */
  debounceMs?: number
  /** 错误回调 */
  onError?: (error: Error) => void
  /** 成功回调 */
  onSuccess?: (status: LikeStatus) => void
}

export interface UseLikeReturn {
  /** 当前点赞状态 */
  status: LikeStatus
  /** 是否正在加载 */
  isLoading: boolean
  /** 是否正在切换点赞状态 */
  isToggling: boolean
  /** 切换点赞状态 */
  toggleLike: () => Promise<void>
  /** 刷新点赞状态 */
  refreshStatus: () => Promise<void>
  /** 错误信息 */
  error: string | null
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
export function useLike(options: UseLikeOptions): UseLikeReturn {
  const {
    artworkId,
    initialStatus = { likeCount: 0, userLiked: false },
    optimistic = true,
    debounceMs = 300,
    onError,
    onSuccess
  } = options

  // 状态管理
  const [status, setStatus] = useState<LikeStatus>(initialStatus)
  const [isLoading, setIsLoading] = useState(false)
  const [isToggling, setIsToggling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 引用管理
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const optimisticStateRef = useRef<LikeStatus | null>(null)

  /**
   * 清理函数
   */
  const cleanup = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  /**
   * 错误处理
   */
  const handleError = useCallback(
    (err: Error) => {
      console.error('useLike error:', err)
      setError(err.message)

      // 如果有乐观更新，回滚状态
      if (optimisticStateRef.current) {
        setStatus(optimisticStateRef.current)
        optimisticStateRef.current = null
      }

      // 显示错误提示
      toast.error(err.message)

      // 调用错误回调
      onError?.(err)
    },
    [onError]
  )

  /**
   * 刷新点赞状态
   */
  const refreshStatus = useCallback(async () => {
    if (isLoading) return

    setIsLoading(true)
    setError(null)

    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    abortControllerRef.current = new AbortController()

    try {
      const newStatus = await fetchLikeStatus(artworkId)
      setStatus(newStatus)
      optimisticStateRef.current = null
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        handleError(err)
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [artworkId, isLoading, handleError])

  /**
   * 切换点赞状态
   */
  const toggleLike = useCallback(async () => {
    if (isToggling) return

    setIsToggling(true)
    setError(null)

    // 清除之前的防抖定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    // 乐观更新
    if (optimistic) {
      optimisticStateRef.current = { ...status }
      const optimisticStatus: LikeStatus = {
        likeCount: status.userLiked ? status.likeCount - 1 : status.likeCount + 1,
        userLiked: !status.userLiked
      }
      setStatus(optimisticStatus)
    }

    // 防抖处理
    debounceTimerRef.current = setTimeout(async () => {
      try {
        // 取消之前的请求
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
        }

        abortControllerRef.current = new AbortController()

        const newStatus = await toggleLikeStatus(artworkId)

        setStatus(newStatus)
        optimisticStateRef.current = null

        // 显示成功提示
        toast.success(newStatus.userLiked ? '点赞成功' : '取消点赞成功')

        // 调用成功回调
        onSuccess?.(newStatus)
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          handleError(err)
        }
      } finally {
        setIsToggling(false)
        abortControllerRef.current = null
      }
    }, debounceMs)
  }, [artworkId, status, optimistic, debounceMs, isToggling, handleError, onSuccess])

  /**
   * 初始化时获取点赞状态
   */
  useEffect(() => {
    if (!initialStatus || (initialStatus.likeCount === 0 && !initialStatus.userLiked)) {
      refreshStatus()
    }
    console.log(artworkId, 'artworkId')
  }, [artworkId]) // 只在 artworkId 或 userId 变化时重新获取

  /**
   * 清理副作用
   */
  useEffect(() => {
    return cleanup
  }, [cleanup])

  return {
    status,
    isLoading,
    isToggling,
    toggleLike,
    refreshStatus,
    error
  }
}

// ============================================================================
// 批量点赞状态 Hook
// ============================================================================

export interface UseBatchLikeOptions {
  /** 作品ID列表 */
  artworkIds: number[]
  /** 用户ID */
  userId: number
  /** 是否自动获取 */
  autoFetch?: boolean
}

export interface UseBatchLikeReturn {
  /** 点赞状态映射 */
  statusMap: Record<number, LikeStatus>
  /** 是否正在加载 */
  isLoading: boolean
  /** 获取批量点赞状态 */
  fetchBatchStatus: () => Promise<void>
  /** 错误信息 */
  error: string | null
}

/**
 * 批量获取点赞状态
 */
async function fetchBatchLikeStatus(artworkIds: number[], userId: number): Promise<Record<number, LikeStatus>> {
  const response = await fetch('/api/artworks/like/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ artworkIds, userId })
  })

  if (!response.ok) {
    throw new Error(`批量获取点赞状态失败: ${response.status}`)
  }

  const result = await response.json()

  if (!result.success) {
    throw new Error(result.error || '批量获取点赞状态失败')
  }

  return result.data
}

/**
 * 批量点赞状态 Hook
 */
export function useBatchLike(options: UseBatchLikeOptions): UseBatchLikeReturn {
  const { artworkIds, userId, autoFetch = true } = options

  const [statusMap, setStatusMap] = useState<Record<number, LikeStatus>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  /**
   * 获取批量点赞状态
   */
  const fetchBatchStatus = useCallback(async () => {
    if (artworkIds.length === 0 || isLoading) return

    setIsLoading(true)
    setError(null)

    // 取消之前的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }

    abortControllerRef.current = new AbortController()

    try {
      const newStatusMap = await fetchBatchLikeStatus(artworkIds, userId)
      setStatusMap(newStatusMap)
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        console.error('useBatchLike error:', err)
        setError(err.message)
        toast.error(err.message)
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [artworkIds, userId, isLoading])

  /**
   * 自动获取
   */
  useEffect(() => {
    if (autoFetch && artworkIds.length > 0) {
      fetchBatchStatus()
    }
  }, [autoFetch, artworkIds, userId, fetchBatchStatus])

  /**
   * 清理副作用
   */
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  return {
    statusMap,
    isLoading,
    fetchBatchStatus,
    error
  }
}
