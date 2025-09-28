'use client'

import React, { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { LoginForm, useAuth } from '@/components'
import { ROUTES } from '@/lib/constants'

// ============================================================================
// 登录页面
// ============================================================================

/**
 * 登录页面内容组件
 */
function LoginPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading } = useAuth()

  // 获取重定向URL
  const redirectTo = searchParams.get('redirect') || ROUTES.DASHBOARD

  /**
   * 如果用户已经登录，重定向到目标页面
   */
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push(redirectTo)
    }
  }, [isAuthenticated, isLoading, redirectTo, router])

  /**
   * 登录成功处理
   */
  const handleLoginSuccess = () => {
    console.log('登录成功')
    // LoginForm 组件会自动处理重定向
  }

  /**
   * 登录失败处理
   */
  const handleLoginError = (error: string) => {
    console.error('登录失败:', error)
    // 错误处理已在 LoginForm 组件中完成
  }

  // 如果正在加载或已经认证，显示加载状态
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      </div>
    )
  }

  // 如果已经认证，显示重定向信息
  if (isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-sm text-muted-foreground">正在跳转...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-accent-50 p-4">
      <div className="w-full max-w-md">
        {/* Logo and Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-neutral-900 mb-2">欢迎回来</h1>
          <p className="text-neutral-600">登录到你的 PixiShelf 账户</p>
        </div>

        {/* 登录表单 */}
        <LoginForm
          redirectTo={redirectTo}
          onSuccess={handleLoginSuccess}
          onError={handleLoginError}
          className="w-full"
        />

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-neutral-500">
          <p>© {new Date().getFullYear()} PixiShelf - 现代化个人画廊</p>
        </div>
      </div>
    </div>
  )
}

/**
 * 登录页面组件（使用Suspense包装）
 */
export default function LoginPage() {
  return <LoginPageContent />
}
