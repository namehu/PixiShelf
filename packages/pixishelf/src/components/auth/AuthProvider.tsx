'use client'

import React, { createContext, useContext, useState, useCallback, useMemo, PropsWithChildren } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { ROUTES, ERROR_MESSAGES } from '@/lib/constants'
import type { AuthMeResponseDTO } from '@/schemas/auth.dto'
import { logoutUserAction } from '@/actions/auth-action'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { useQuery, useQueryClient } from '@tanstack/react-query'

// ============================================================================
// 认证上下文提供者
// ============================================================================

/**
 * 认证上下文
 */
interface AuthContextType {
  /** 当前用户 */
  user: AuthMeResponseDTO | null
  /** 登出方法 */
  logout: () => Promise<void>
  /** 刷新用户信息 */
  refreshUser: () => Promise<any>
}

/**
 * 认证上下文
 */
const AuthContext = createContext<AuthContextType | undefined>(undefined)

/**
 * 认证提供者组件
 */
export const AuthProvider: React.FC<
  PropsWithChildren<{
    /** 初始用户信息（服务端注入） */
    initialUser?: AuthMeResponseDTO | null
  }>
> = ({ children, initialUser }) => {
  const router = useRouter()
  const pathname = usePathname()
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  // 使用 state 保存 initialUser，以便在登出时可以将其清除，
  // 防止 React Query 在缓存被清空后回退到 initialData
  const [initialUserData, setInitialUserData] = useState(initialUser)

  const userQuery = useQuery({
    ...trpc.auth.me.queryOptions(),
    initialData: initialUserData ? initialUserData : undefined,
    enabled: pathname !== ROUTES.LOGIN,
    staleTime: 5 * 60 * 1000, // 5分钟内数据视为新鲜
    retry: false,
    refetchOnWindowFocus: false
  })

  /**
   * 登出
   */
  const logout = useCallback(async () => {
    // 登出时清除初始数据，防止 React Query 回退
    setInitialUserData(null)

    try {
      await logoutUserAction()
    } catch (error) {
      toast.error('登出失败', {
        description: error instanceof Error ? error.message : ERROR_MESSAGES.SERVER_ERROR
      })
    } finally {
      // 清除缓存数据
      const queryKey = trpc.auth.me.queryOptions().queryKey

      // 1. 取消任何正在进行的请求
      await queryClient.cancelQueries({ queryKey })

      // 2. 显式将数据设置为 null，这会立即触发 UI 更新
      queryClient.setQueryData(queryKey, undefined)

      // 3. 移除查询缓存，确保下次请求重新获取
      queryClient.removeQueries({ queryKey })

      router.push(ROUTES.LOGIN)
    }
  }, [router, trpc, queryClient])

  /**
   * 构建上下文值
   */
  const contextValue: AuthContextType = useMemo(() => {
    return {
      user: userQuery.data ?? null,
      logout,
      refreshUser: () => userQuery.refetch()
    }
  }, [userQuery.data, logout])

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
}

/**
 * 使用认证上下文的Hook
 */
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext)

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }

  return context
}
