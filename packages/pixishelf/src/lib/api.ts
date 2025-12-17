'use client'

import { ApiResponse } from '@/types/api'

export async function apiRequest(url: string, options: RequestInit = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  } as Record<string, string>

  const response = await fetch(url, {
    ...options,
    headers
  })

  if (response.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('token')
      setTimeout(() => {
        window.location.href = '/login'
      }, 0)
    }
    throw new Error('Unauthorized')
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `HTTP ${response.status}`)
  }

  return response
}

export async function apiJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await apiRequest(url, options)
  return response.json() as Promise<T>
}

/**
 * 通用的 fetch 包装器
 * T: 你期望获得的数据类型 (例如 Tag)
 */
export async function client<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)

  // 1. 解析 JSON
  const result = (await response.json()) as ApiResponse<T>

  // 2. 统一错误处理
  // 如果 http 状态码不是 2xx，或者业务状态 success 为 false
  if (!response.ok || !result.success) {
    const errorMessage = result.error || 'Network request failed'
    // 这里抛出的错误会被 React Query 捕获
    throw new Error(errorMessage)
  }

  // 3. 只有成功时，才返回 data 部分
  // 使用 ! 断言 data 一定存在（因为 success 为 true）
  return result.data!
}
