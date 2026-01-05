'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { ROUTES, ERROR_MESSAGES } from '@/lib/constants'
import { LockKeyholeIcon, UserIcon } from 'lucide-react'
import { useAction } from 'next-safe-action/hooks'
import { loginUserAction } from '@/actions/login-action'
import { AuthLoginSchema } from '@/schemas/auth.dto'
import z from 'zod'

export interface LoginFormProps {
  /** 登录成功后的重定向URL */
  redirectTo?: string
  /** 自定义类名 */
  className?: string
  /** 登录失败回调 */
  onError?: (error: string) => void
}

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
export const LoginForm: React.FC<LoginFormProps> = ({ redirectTo, className, onError }) => {
  const router = useRouter()

  const { execute, isExecuting } = useAction(loginUserAction, {
    onSuccess: ({ data }) => {
      // 重定向到指定页面或默认页面
      const targetUrl = redirectTo || ROUTES.DASHBOARD
      router.replace(targetUrl)
    },
    onError: ({ error }) => {
      const errorMessage = error.serverError || ERROR_MESSAGES.LOGIN_FAILED
      setErrors({ general: errorMessage })
      onError?.(errorMessage)
    }
  })

  const isLoading = isExecuting

  const [formState, setFormState] = useState<FormState>({
    username: '',
    password: ''
  })
  const [errors, setErrors] = useState<FormErrors>({})

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
      AuthLoginSchema.parse({
        username: formState.username,
        password: formState.password
      })
      execute(formState)
    } catch (error) {
      if (error instanceof z.ZodError) {
        setErrors(error.flatten().fieldErrors)
      }
    }
  }

  return (
    <Card className={className}>
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
              <svg
                className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <h4 className="text-sm font-medium text-destructive">登录失败</h4>
                <p className="text-sm text-destructive/80 mt-1">{errors.general}</p>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <Button type="submit" disabled={isLoading} className="w-full" size="lg">
            {isLoading ? (
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
