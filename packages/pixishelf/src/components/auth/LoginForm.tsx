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
export const LoginForm: React.FC<LoginFormProps> = ({ redirectTo, className, onSuccess, onError }) => {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [formState, setFormState] = useState<FormState>({
    username: '',
    password: '',
    rememberMe: false
  })
  const [errors, setErrors] = useState<FormErrors>({})

  /**
   * 处理输入变化
   */
  const handleInputChange = (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value

    setFormState((prev) => ({
      ...prev,
      [field]: value
    }))

    // 清除对应字段的错误
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({
        ...prev,
        [field]: undefined
      }))
    }
  }

  /**
   * 验证表单
   */
  const validateForm = (): boolean => {
    const validation = validateLoginForm({
      username: formState.username,
      password: formState.password
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
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(loginData)
      })

      const data = await response.json()

      if (!response.ok || !data.success || !data.token) {
        throw new Error(data.error || ERROR_MESSAGES.LOGIN_FAILED)
      }

      // token由AuthProvider处理，这里只需要返回成功状态
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
      debugger
      const loginData: LoginRequest = {
        username: formState.username.trim(),
        password: formState.password,
        rememberMe: formState.rememberMe
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
    <div className={`card p-8 ${className}`}>
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Username Field */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-neutral-700">用户名</label>
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-neutral-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
            <input
              type="text"
              value={formState.username}
              onChange={handleInputChange('username')}
              className="input pl-11"
              placeholder="输入用户名"
              required
              disabled={isLoading}
              autoComplete="username"
            />
          </div>
          {errors.username && <p className="text-sm text-red-600">{errors.username}</p>}
        </div>

        {/* Password Field */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-neutral-700">密码</label>
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-neutral-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <input
              type="password"
              value={formState.password}
              onChange={handleInputChange('password')}
              className="input pl-11"
              placeholder="输入密码"
              required
              disabled={isLoading}
              autoComplete="current-password"
            />
          </div>
          {errors.password && <p className="text-sm text-red-600">{errors.password}</p>}
        </div>

        {/* Error Message */}
        {errors.general && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <svg
              className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0"
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
              <h4 className="text-sm font-medium text-red-800">登录失败</h4>
              <p className="text-sm text-red-700 mt-1">{errors.general}</p>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className="btn btn-primary btn-lg w-full disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              登录中...
            </div>
          ) : (
            '登录'
          )}
        </button>
      </form>
    </div>
  )
}
