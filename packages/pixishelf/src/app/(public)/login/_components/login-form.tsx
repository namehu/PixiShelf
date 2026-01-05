'use client'

import React, { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { ROUTES } from '@/lib/constants'
import { CircleXIcon, LockKeyholeIcon, UserIcon } from 'lucide-react'
import { useAction } from 'next-safe-action/hooks'
import { loginUserAction } from '@/actions/auth-action'
import { authLoginSchema } from '@/schemas/auth.dto'
import z from 'zod'
import { useAuth } from '@/components/auth'
import { AuthLoading } from './auth-loading'

/**
 * 表单状态接口
 */
interface FormState {
  username: string
  password: string
}

/**
 * 表单错误接口
 */
interface FormErrors {
  username?: string
  password?: string
  general?: string
}

/**
 * 登录表单组件
 */
export const LoginForm: React.FC = () => {
  const router = useRouter()
  const searchParams = useSearchParams()

  const { refreshUser, isAuthenticated, isLoading } = useAuth()
  const redirectTo = searchParams.get('redirect') || ROUTES.DASHBOARD

  const { execute, isExecuting } = useAction(loginUserAction, {
    onSuccess: async () => {
      await refreshUser()
      router.replace(redirectTo)
    },
    onError: ({ error }) => {
      const { fieldErrors = {}, formErrors = [] } = error.validationErrors || {}
      setErrors((pre) => ({
        ...pre,
        general: formErrors[0] || '登录失败',
        username: fieldErrors.username?.[0],
        password: fieldErrors.password?.[0]
      }))
    }
  })

  const [formState, setFormState] = useState<FormState>({
    username: '',
    password: ''
  })
  const [errors, setErrors] = useState<FormErrors>({})

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(redirectTo)
    }
  }, [isAuthenticated, isLoading, redirectTo, router])

  /**
   * 处理输入变化
   */
  const handleInputChange = (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target
    setFormState((prev) => ({ ...prev, [field]: value }))
    // 清除对应字段的错误
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  /**
   * 处理表单提交
   */
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrors({})

    try {
      const data = authLoginSchema.parse({ username: formState.username, password: formState.password })
      execute(data)
    } catch (error) {
      if (error instanceof z.ZodError) {
        setErrors((pre) => ({ ...pre, ...z.flattenError(error).fieldErrors }))
      }
    }
  }

  // 1. 加载中 或 2. 已登录正在跳转
  if (isLoading || isAuthenticated) {
    return <AuthLoading text={isAuthenticated ? '正在跳转...' : '正在检查登录状态...'} />
  }

  return (
    <Card className="border-none shadow-none bg-transparent p-0 [&>div]:p-0">
      <CardContent className="p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">用户名</label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground z-10" />
              <Input
                type="text"
                value={formState.username}
                onChange={handleInputChange('username')}
                className="pl-11"
                placeholder="输入用户名"
                required
                disabled={isLoading}
                autoComplete="username"
              />
            </div>
            {errors.username && <p className="text-sm text-destructive">{errors.username}</p>}
          </div>

          {/* Password Field */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">密码</label>
            <div className="relative">
              <LockKeyholeIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground z-10" />
              <Input
                type="password"
                value={formState.password}
                onChange={handleInputChange('password')}
                className="pl-11"
                placeholder="输入密码"
                required
                disabled={isLoading}
                autoComplete="current-password"
              />
            </div>
            {errors.password && <p className="text-sm text-destructive">{errors.password}</p>}
          </div>

          {/* Error Message */}
          {errors.general && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 flex items-start gap-3">
              <CircleXIcon className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-sm text-destructive/80 mt-1">{errors.general}</p>
            </div>
          )}

          {/* Submit Button */}
          <Button type="submit" disabled={isExecuting} className="w-full" size="lg">
            {isExecuting ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                登录中...
              </div>
            ) : (
              '登录'
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
