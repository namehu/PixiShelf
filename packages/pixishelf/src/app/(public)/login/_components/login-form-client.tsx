'use client'

import React, { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/auth'
import { ROUTES } from '@/lib/constants'
import { LoginForm } from './login-form'
import { AuthLoading } from './auth-loading'

export function LoginFormClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading } = useAuth()

  const redirectTo = searchParams.get('redirect') || ROUTES.DASHBOARD

  // 状态检查与重定向
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(redirectTo)
    }
  }, [isAuthenticated, isLoading, redirectTo, router])

  // 1. 加载中 或 2. 已登录正在跳转
  if (isLoading || isAuthenticated) {
    return <AuthLoading text={isAuthenticated ? '正在跳转...' : '正在检查登录状态...'} />
  }

  // 未登录状态：显示表单
  return (
    <div className="relative">
      <LoginForm redirectTo={redirectTo} className="border-none shadow-none bg-transparent p-0 [&>div]:p-0" />
    </div>
  )
}
