'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ROUTES, ERROR_MESSAGES } from '@/lib/constants'
import type { AuthContextType, AuthState, User } from '@/types'

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
}

/**
 * 认证提供者组件
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const router = useRouter()
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    isLoading: true,
    error: null,
  })

  /**
   * 设置认证状态
   */
  const setAuth = useCallback((updates: Partial<AuthState>) => {
    setAuthState(prev => ({ ...prev, ...updates }))
  }, [])

  /**
   * 清除错误
   */
  const clearError = useCallback(() => {
    setAuth({ error: null })
  }, [setAuth])

  /**
   * 获取存储的token
   */
  const getStoredToken = (): string | null => {
    if (typeof window === 'undefined') return null
    return localStorage.getItem('auth-token')
  }

  /**
   * 设置存储的token
   */
  const setStoredToken = (token: string): void => {
    if (typeof window === 'undefined') return
    localStorage.setItem('auth-token', token)
  }

  /**
   * 移除存储的token
   */
  const removeStoredToken = (): void => {
    if (typeof window === 'undefined') return
    localStorage.removeItem('auth-token')
  }

  /**
   * 获取当前用户信息
   */
  const fetchUser = useCallback(async (): Promise<User | null> => {
    try {
      const token = getStoredToken()
      if (!token) {
        return null
      }

      const response = await fetch('/api/auth/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        if (response.status === 401) {
          // token无效，清除本地存储
          removeStoredToken()
          return null
        }
        throw new Error('获取用户信息失败')
      }

      const data = await response.json()
      
      if (!data.success || !data.user) {
        return null
      }

      return {
        id: data.user.id,
        username: data.user.username,
        passwordHash: '', // 前端不需要密码哈希
        createdAt: new Date().toISOString(), // 这里可以从API返回实际的创建时间
        updatedAt: new Date().toISOString(), // 这里可以从API返回实际的更新时间
      }
    } catch (error) {
      console.error('获取用户信息错误:', error)
      // token无效时清除
      removeStoredToken()
      throw error
    }
  }, [])

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
        isLoading: false,
      })
    } catch (error) {
      console.error('刷新用户信息错误:', error)
      setAuth({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: error instanceof Error ? error.message : ERROR_MESSAGES.SERVER_ERROR,
      })
    }
  }, [fetchUser, setAuth])

  /**
   * 登录
   */
  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    try {
      setAuth({ isLoading: true, error: null })

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      })

      const data = await response.json()

      if (!response.ok || !data.success || !data.token) {
        throw new Error(data.error || ERROR_MESSAGES.LOGIN_FAILED)
      }

      // 存储token
      setStoredToken(data.token)

      // 登录成功，获取用户信息
      const user = await fetchUser()
      
      if (!user) {
        throw new Error('登录成功但无法获取用户信息')
      }

      setAuth({
        isAuthenticated: true,
        user,
        isLoading: false,
        error: null,
      })

      return true
    } catch (error) {
      console.error('登录错误:', error)
      removeStoredToken()
      const errorMessage = error instanceof Error ? error.message : ERROR_MESSAGES.LOGIN_FAILED
      
      setAuth({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: errorMessage,
      })

      return false
    }
  }, [fetchUser, setAuth])

  /**
   * 登出
   */
  const logout = useCallback(async () => {
    try {
      setAuth({ isLoading: true })

      // 清除本地token
      removeStoredToken()

      setAuth({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: null,
      })

      // 重定向到登录页
      router.push(ROUTES.LOGIN)
    } catch (error) {
      console.error('登出错误:', error)
      
      // 即使出错也要清除本地状态
      removeStoredToken()
      setAuth({
        isAuthenticated: false,
        user: null,
        isLoading: false,
        error: null,
      })

      router.push(ROUTES.LOGIN)
    }
  }, [router, setAuth])

  /**
   * 初始化认证状态
   */
  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  /**
   * 构建上下文值
   */
  const contextValue: AuthContextType = {
    ...authState,
    login,
    logout,
    refreshUser,
    clearError,
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
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

/**
 * 检查是否已认证的Hook
 */
export const useRequireAuth = () => {
  const { isAuthenticated, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push(ROUTES.LOGIN)
    }
  }, [isAuthenticated, isLoading, router])

  return { isAuthenticated, isLoading }
}