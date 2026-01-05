'use client'

import React, { createContext, useContext, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ROUTES, ERROR_MESSAGES } from '@/lib/constants'
import type { AuthContextType, AuthState } from '@/types'
import { api } from '@/lib/request'
import type { AuthMeResponseDTO } from '@/schemas/auth.dto'
import { logoutUserAction } from '@/actions/auth-action'
import { toast } from 'sonner'

// ============================================================================
// 认证上下文提供者
// ============================================================================

/**
 * 认证上下文
 */
const AuthContext = createContext<AuthContextType | undefined>(undefined)

/**
 * 认证提供者组件属性
 */
export interface AuthProviderProps {
  /** 子组件 */
  children: React.ReactNode
  /** 初始用户信息（服务端注入） */
  initialUser?: AuthMeResponseDTO | null
}

/**
 * 认证提供者组件
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children, initialUser }) => {
  const router = useRouter()

  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: !!initialUser,
    user: initialUser || null,
    isLoading: initialUser === undefined, // 如果显式传入了 null 或 user，则不加载
    error: null
  })

  /**
   * 设置认证状态
   */
  const setAuth = useCallback((updates: Partial<AuthState>) => {
    setAuthState((prev) => ({ ...prev, ...updates }))
  }, [])

  /**
   * 清除错误
   */
  const clearError = useCallback(() => {
    setAuth({ error: null })
  }, [setAuth])

  /**
   * 获取当前用户信息
   */
  const fetchUser = useCallback(async (): Promise<AuthMeResponseDTO> => api.get['/api/auth/me']()!, [])

  /**
   * 刷新用户信息
   */
  const refreshUser = useCallback(async () => {
    try {
      setAuth({ isLoading: true, error: null })

      const user = await fetchUser()

      setAuth({
        isAuthenticated: Boolean(user),
        user,
        isLoading: false
      })
    } catch (error) {
      // oxlint-disable-next-line no-console
      console.error('刷新用户信息错误:', error)
      setAuth({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: error instanceof Error ? error.message : ERROR_MESSAGES.SERVER_ERROR
      })
    }
  }, [fetchUser, setAuth])

  /**
   * 登出
   */
  const logout = useCallback(async () => {
    try {
      setAuth({ isLoading: true })
      // 调用登出API
      await logoutUserAction()
    } catch (error) {
      toast.error('登出失败', {
        description: error instanceof Error ? error.message : ERROR_MESSAGES.SERVER_ERROR
      })
    }
    // 清除本地状态
    setAuth({
      isAuthenticated: false,
      user: null,
      isLoading: false,
      error: null
    })
    router.push(ROUTES.LOGIN)
  }, [router, setAuth])

  /**
   * 构建上下文值
   */
  const contextValue: AuthContextType = {
    ...authState,
    logout,
    refreshUser,
    clearError
  }

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
