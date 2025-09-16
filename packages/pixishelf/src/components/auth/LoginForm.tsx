'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui'
import { validateLoginForm } from '@/lib/validators'
import { ROUTES, ERROR_MESSAGES } from '@/lib/constants'
import type { LoginRequest } from '@/types/auth'

// ============================================================================
// 登录表单组件
// ============================================================================

export interface LoginFormProps {
  /** 登录成功后的重定向URL */
  redirectTo?: string
  /** 自定义类名 */
  className?: string
  /** 登录成功回调 */
  onSuccess?: () => void
  /** 登录失败回调 */
  onError?: (error: string) => void
}

/**
 * 表单状态接口
 */
interface FormState {
  username: string
  password: string
  rememberMe: boolean
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
export const LoginForm: React.FC<LoginFormProps> = ({
  redirectTo,
  className,
  onSuccess,
  onError,
}) => {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [formState, setFormState] = useState<FormState>({
    username: '',
    password: '',
    rememberMe: false,
  })
  const [errors, setErrors] = useState<FormErrors>({})

  /**
   * 处理输入变化
   */
  const handleInputChange = (field: keyof FormState) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    
    setFormState(prev => ({
      ...prev,
      [field]: value,
    }))

    // 清除对应字段的错误
    if (errors[field as keyof FormErrors]) {
      setErrors(prev => ({
        ...prev,
        [field]: undefined,
      }))
    }
  }

  /**
   * 验证表单
   */
  const validateForm = (): boolean => {
    const validation = validateLoginForm({
      username: formState.username,
      password: formState.password,
    })

    if (!validation.isValid) {
      setErrors(validation.errors)
      return false
    }

    setErrors({})
    return true
  }

  /**
   * 提交登录请求
   */
  const submitLogin = async (loginData: LoginRequest): Promise<boolean> => {
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(loginData),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || ERROR_MESSAGES.LOGIN_FAILED)
      }

      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : ERROR_MESSAGES.LOGIN_FAILED
      setErrors({ general: errorMessage })
      onError?.(errorMessage)
      return false
    }
  }

  /**
   * 处理表单提交
   */
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    // 验证表单
    if (!validateForm()) {
      return
    }

    setIsLoading(true)
    setErrors({})

    try {
      const loginData: LoginRequest = {
        username: formState.username.trim(),
        password: formState.password,
        rememberMe: formState.rememberMe,
      }

      const success = await submitLogin(loginData)

      if (success) {
        onSuccess?.()
        
        // 重定向到指定页面或默认页面
        const targetUrl = redirectTo || ROUTES.DASHBOARD
        router.push(targetUrl)
      }
    } catch (error) {
      console.error('登录提交错误:', error)
      const errorMessage = error instanceof Error ? error.message : ERROR_MESSAGES.SERVER_ERROR
      setErrors({ general: errorMessage })
      onError?.(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-center">登录</CardTitle>
      </CardHeader>
      
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {/* 通用错误信息 */}
          {errors.general && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
              {errors.general}
            </div>
          )}

          {/* 用户名输入 */}
          <Input
            label="用户名"
            type="text"
            value={formState.username}
            onChange={handleInputChange('username')}
            error={errors.username}
            placeholder="请输入用户名"
            disabled={isLoading}
            fullWidth
            autoComplete="username"
            required
          />

          {/* 密码输入 */}
          <Input
            label="密码"
            type="password"
            value={formState.password}
            onChange={handleInputChange('password')}
            error={errors.password}
            placeholder="请输入密码"
            disabled={isLoading}
            fullWidth
            autoComplete="current-password"
            required
          />

          {/* 记住我选项 */}
          <div className="flex items-center space-x-2">
            <input
              id="rememberMe"
              type="checkbox"
              checked={formState.rememberMe}
              onChange={handleInputChange('rememberMe')}
              disabled={isLoading}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label
              htmlFor="rememberMe"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              记住我
            </label>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          {/* 登录按钮 */}
          <Button
            type="submit"
            loading={isLoading}
            disabled={isLoading}
            fullWidth
            size="lg"
          >
            {isLoading ? '登录中...' : '登录'}
          </Button>

          {/* 其他链接 */}
          <div className="text-center text-sm text-muted-foreground">
            <span>还没有账户？</span>
            <a
              href={ROUTES.REGISTER}
              className="ml-1 text-primary hover:underline"
            >
              立即注册
            </a>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}