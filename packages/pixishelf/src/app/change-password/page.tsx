'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ChangePasswordRequest, ChangePasswordResponse } from '@/types'
import { useAuth } from '@/components/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiJson } from '@/lib/api'
import { ROUTES } from '@/lib/constants'
import PNav from '@/components/layout/PNav'

// ============================================================================
// 修改密码页面
// ============================================================================

/**
 * 修改密码Hook
 */
function useChangePassword() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changePassword = async (data: ChangePasswordRequest): Promise<ChangePasswordResponse> => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await apiJson<ChangePasswordResponse>('/api/users/password', {
        method: 'PUT',
        body: JSON.stringify(data)
      })
      return result
    } catch (err: any) {
      const errorMessage = err.message || '密码修改失败'
      setError(errorMessage)
      throw new Error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  return {
    changePassword,
    isLoading,
    error,
    setError
  }
}

/**
 * 密码强度验证
 */
function getPasswordStrength(password: string) {
  if (password.length < 6) return { level: 'weak' as const, text: '密码长度至少6位' }
  if (password.length < 8) return { level: 'medium' as const, text: '密码强度：中等' }
  if (password.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)) {
    return { level: 'strong' as const, text: '密码强度：强' }
  }
  return { level: 'medium' as const, text: '密码强度：中等' }
}

/**
 * 修改密码页面组件
 */
export default function ChangePasswordPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading: authLoading, logout } = useAuth()
  const { changePassword, isLoading, error, setError } = useChangePassword()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [success, setSuccess] = useState(false)

  // 检查认证状态
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push(`${ROUTES.LOGIN}?redirect=/change-password`)
    }
  }, [isAuthenticated, authLoading, router])

  // 如果正在加载认证状态，显示加载页面
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      </div>
    )
  }

  // 如果未认证，不渲染内容（会被重定向）
  if (!isAuthenticated) {
    return null
  }

  const passwordStrength = getPasswordStrength(newPassword)
  const isPasswordMatch = newPassword && confirmPassword && newPassword === confirmPassword
  const canSubmit = currentPassword && newPassword && confirmPassword && isPasswordMatch && !isLoading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!canSubmit) return

    try {
      await changePassword({
        currentPassword,
        newPassword
      })
      setSuccess(true)
    } catch (err) {
      // 错误已在hook中处理
    }
  }

  const handleBack = () => {
    router.back()
  }

  const handleReLogin = async () => {
    await logout()
    router.push(ROUTES.LOGIN)
  }

  // 成功页面
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-accent-50 p-4">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-neutral-900 mb-4">密码修改成功</h1>
            <p className="text-neutral-600 mb-8">你的密码已成功修改。为了安全起见，建议重新登录。</p>
            <div className="space-y-3">
              <Button onClick={handleReLogin} className="w-full">
                重新登录
              </Button>
              <Button onClick={handleBack} variant="secondary" className="w-full">
                返回
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PNav />
      <main className="max-w-7xl mx-auto pt-16 lg:px-8">
        <div className="flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-accent-50 p-4">
          <div className="w-full max-w-md">
            {/* 页面头部 */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-gradient-to-br from-primary-500 to-accent-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-neutral-900 mb-2">修改密码</h1>
              <p className="text-neutral-600">为了账户安全，请输入当前密码并设置新密码</p>
            </div>

            {/* 密码修改表单 */}
            <div className="bg-white rounded-2xl shadow-lg p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* 当前密码 */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">当前密码</label>
                  <div className="relative">
                    <svg
                      className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none"
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
                    <Input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="输入当前密码"
                      required
                      disabled={isLoading}
                      className="pl-10"
                    />
                  </div>
                </div>

                {/* 新密码 */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">新密码</label>
                  <div className="relative">
                    <svg
                      className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none"
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
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="输入新密码"
                      required
                      disabled={isLoading}
                      className="pl-10"
                    />
                  </div>
                  {/* 密码强度指示器 */}
                  {newPassword && (
                    <div className="flex items-center gap-2 mt-2">
                      <div
                        className={`h-2 w-full rounded-full ${
                          passwordStrength.level === 'weak'
                            ? 'bg-red-200'
                            : passwordStrength.level === 'medium'
                              ? 'bg-yellow-200'
                              : 'bg-green-200'
                        }`}
                      >
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            passwordStrength.level === 'weak'
                              ? 'w-1/3 bg-red-500'
                              : passwordStrength.level === 'medium'
                                ? 'w-2/3 bg-yellow-500'
                                : 'w-full bg-green-500'
                          }`}
                        />
                      </div>
                      <span
                        className={`text-xs font-medium ${
                          passwordStrength.level === 'weak'
                            ? 'text-red-600'
                            : passwordStrength.level === 'medium'
                              ? 'text-yellow-600'
                              : 'text-green-600'
                        }`}
                      >
                        {passwordStrength.text}
                      </span>
                    </div>
                  )}
                </div>

                {/* 确认新密码 */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">确认新密码</label>
                  <div className="relative">
                    <svg
                      className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none"
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
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="再次输入新密码"
                      required
                      disabled={isLoading}
                      className={`pl-10 pr-10 ${confirmPassword && !isPasswordMatch ? 'border-destructive' : ''}`}
                    />
                    {confirmPassword && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none">
                        {isPasswordMatch ? (
                          <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        )}
                      </div>
                    )}
                  </div>
                  {confirmPassword && !isPasswordMatch && (
                    <div className="text-sm">
                      <span className="text-destructive">密码不匹配</span>
                    </div>
                  )}
                </div>

                {/* 错误提示 */}
                {error && (
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
                      <h4 className="text-sm font-medium text-red-800">修改失败</h4>
                      <p className="text-sm text-red-700 mt-1">{error}</p>
                    </div>
                  </div>
                )}

                {/* 操作按钮 */}
                <div className="space-y-3">
                  <Button type="submit" size="lg" className="w-full" disabled={!canSubmit || isLoading}>
                    {isLoading ? '修改中...' : '修改密码'}
                  </Button>
                  <Button
                    type="button"
                    onClick={handleBack}
                    variant="secondary"
                    className="w-full"
                    disabled={isLoading}
                  >
                    返回
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
