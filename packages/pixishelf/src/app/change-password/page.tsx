'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ROUTES } from '@/lib/constants'
import { useAction } from 'next-safe-action/hooks'
import { changePasswordAction } from '@/actions/auth-action'
import { toast } from 'sonner'
import PLogo from '@/components/layout/p-logo'
import { LockKeyholeIcon } from 'lucide-react'

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

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [success, setSuccess] = useState(false)

  const [error, setError] = useState<string | null>()

  const { execute, isExecuting } = useAction(changePasswordAction, {
    onSuccess: () => {
      setSuccess(true)
      toast.success('密码修改成功，请重新登录')
      setTimeout(async () => {
        await logout()
        router.push(ROUTES.LOGIN)
      }, 1500)
    },
    onError: ({ error }) => {
      const { fieldErrors = {}, formErrors = [] } = error.validationErrors || {}

      if (fieldErrors.currentPassword) {
        setError(fieldErrors.currentPassword[0])
      } else if (fieldErrors.newPassword) {
        setError(fieldErrors.newPassword[0])
      } else if (formErrors.length > 0) {
        setError(formErrors[0])
      } else if (error.serverError) {
        setError(error.serverError)
      } else {
        setError('密码修改失败')
      }
    }
  })

  // 检查认证状态
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push(`${ROUTES.LOGIN}?redirect=/change-password`)
    }
  }, [isAuthenticated, authLoading, router])

  // 如果正在加载认证状态，显示加载页面
  if (authLoading) {
    return (
      <div className="min-h-screen w-full flex bg-background items-center justify-center">
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
  const canSubmit = currentPassword && newPassword && confirmPassword && isPasswordMatch && !isExecuting

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!canSubmit) return

    execute({ currentPassword, newPassword })
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
      <div className="min-h-screen w-full flex bg-background">
        {/* 左侧：静态插画区域 */}
        <div className="hidden lg:flex lg:w-1/2 xl:w-[60%] relative overflow-hidden bg-slate-900">
          <div className="absolute inset-0 w-full h-full">
            <div className="w-full h-full bg-gradient-to-br from-blue-600 to-indigo-900 relative">
              <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:24px_24px]" />
              <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-400/30 rounded-full blur-3xl" />
              <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl" />
            </div>
          </div>

          {/* 品牌信息 */}
          <div className="relative z-10 flex flex-col justify-between w-full h-full p-12 text-white">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm">
                <PLogo className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight">PixiShelf</span>
            </div>

            <div className="space-y-6 max-w-lg">
              <h1 className="text-5xl font-bold leading-tight">
                账户安全 <br />
                始于强密码
              </h1>
              <p className="text-lg text-blue-100/80 leading-relaxed">定期修改密码可以有效保护您的数字资产安全。</p>
            </div>

            <div className="flex items-center gap-4 text-sm text-blue-200/60">
              <span>© {new Date().getFullYear()} PixiShelf</span>
            </div>
          </div>
        </div>

        {/* 右侧：成功提示 */}
        <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 lg:p-12 relative">
          <div className="w-full max-w-[400px] text-center">
            <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-500/20">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-neutral-900 mb-2">密码修改成功</h2>
            <p className="text-muted-foreground mb-8">您的密码已成功更新。为了安全起见，请使用新密码重新登录。</p>
            <div className="space-y-3">
              <Button onClick={handleReLogin} className="w-full" size="lg">
                重新登录
              </Button>
              <Button onClick={handleBack} variant="secondary" className="w-full" size="lg">
                返回
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* 左侧：静态插画区域 */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[60%] relative overflow-hidden bg-slate-900">
        <div className="absolute inset-0 w-full h-full">
          <div className="w-full h-full bg-gradient-to-br from-blue-600 to-indigo-900 relative">
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:24px_24px]" />
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-400/30 rounded-full blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-400/20 rounded-full blur-3xl" />
          </div>
        </div>

        {/* 品牌信息 */}
        <div className="relative z-10 flex flex-col justify-between w-full h-full p-12 text-white">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm">
              <PLogo className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">PixiShelf</span>
          </div>

          <div className="space-y-6 max-w-lg">
            <h1 className="text-5xl font-bold leading-tight">
              账户安全 <br />
              始于强密码
            </h1>
            <p className="text-lg text-blue-100/80 leading-relaxed">定期修改密码可以有效保护您的数字资产安全。</p>
          </div>

          <div className="flex items-center gap-4 text-sm text-blue-200/60">
            <span>© {new Date().getFullYear()} PixiShelf</span>
          </div>
        </div>
      </div>

      {/* 右侧：交互区域 */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 lg:p-12 relative">
        {/* 移动端 Logo */}
        <div className="lg:hidden absolute top-8 left-8 flex items-center gap-2">
          <div className="p-1.5 bg-primary/10 rounded-md">
            <PLogo className="w-5 h-5 text-primary" />
          </div>
          <span className="font-bold text-lg">PixiShelf</span>
        </div>

        <div className="w-full max-w-[400px] space-y-8">
          <div className="space-y-2 text-center lg:text-left">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">修改密码</h2>
            <p className="text-muted-foreground">为了账户安全，请输入当前密码并设置新密码</p>
          </div>

          {/* 密码修改表单 */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 当前密码 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">当前密码</label>
              <div className="relative">
                <LockKeyholeIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground z-10" />
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="输入当前密码"
                  required
                  disabled={isExecuting}
                  className="pl-11"
                />
              </div>
            </div>

            {/* 新密码 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">新密码</label>
              <div className="relative">
                <LockKeyholeIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground z-10" />
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="输入新密码"
                  required
                  disabled={isExecuting}
                  className="pl-11"
                />
              </div>
              {/* 密码强度指示器 */}
              {newPassword && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="h-1.5 flex-1 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
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
              <label className="text-sm font-medium text-foreground">确认新密码</label>
              <div className="relative">
                <LockKeyholeIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground z-10" />
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入新密码"
                  required
                  disabled={isExecuting}
                  className={`pl-11 ${confirmPassword && !isPasswordMatch ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                />
              </div>
              {confirmPassword && !isPasswordMatch && <p className="text-sm text-destructive">两次输入的密码不一致</p>}
            </div>

            {/* 错误提示 */}
            {error && (
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
                  <h4 className="text-sm font-medium text-destructive">修改失败</h4>
                  <p className="text-sm text-destructive/80 mt-1">{error}</p>
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="space-y-3 pt-2">
              <Button type="submit" size="lg" className="w-full" disabled={!canSubmit || isExecuting}>
                {isExecuting ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    修改中...
                  </div>
                ) : (
                  '修改密码'
                )}
              </Button>
              <Button type="button" onClick={handleBack} variant="ghost" className="w-full" disabled={isExecuting}>
                返回
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
