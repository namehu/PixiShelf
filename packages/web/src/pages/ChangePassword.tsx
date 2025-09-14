import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { apiJson } from '../api'
import { ChangePasswordRequest, ChangePasswordResponse } from '@pixishelf/shared'
import { PageContainer } from '../components/PageContainer'

// Hook: 修改密码
function useChangePassword() {
  return useMutation({
    mutationFn: async (data: ChangePasswordRequest): Promise<ChangePasswordResponse> => {
      return apiJson<ChangePasswordResponse>('/api/v1/users/password', {
        method: 'PUT',
        body: JSON.stringify(data)
      })
    }
  })
}

export default function ChangePassword() {
  const navigate = useNavigate()
  const changePassword = useChangePassword()
  
  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState(false)

  // 密码强度验证
  const getPasswordStrength = (password: string) => {
    if (password.length < 6) return { level: 'weak', text: '密码长度至少6位' }
    if (password.length < 8) return { level: 'medium', text: '密码强度：中等' }
    if (password.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)) {
      return { level: 'strong', text: '密码强度：强' }
    }
    return { level: 'medium', text: '密码强度：中等' }
  }

  const passwordStrength = getPasswordStrength(newPassword)
  const isPasswordMatch = newPassword && confirmPassword && newPassword === confirmPassword
  const canSubmit = currentPassword && newPassword && confirmPassword && isPasswordMatch && !changePassword.isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    
    if (!canSubmit) return
    
    try {
      await changePassword.mutateAsync({
        currentPassword,
        newPassword
      })
      setSuccess(true)
    } catch (err: any) {
      setError(err.message || '密码修改失败')
    }
  }

  const handleBackToSettings = () => {
    navigate('/settings')
  }

  const handleReLogin = () => {
    localStorage.removeItem('token')
    window.location.href = '/login'
  }

  if (success) {
    return (
      <PageContainer>
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-accent-50 p-4">
          <div className="w-full max-w-md">
            <div className="card p-8 text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-neutral-900 mb-4">
                密码修改成功
              </h1>
              <p className="text-neutral-600 mb-8">
                你的密码已成功修改。为了安全起见，建议重新登录。
              </p>
              <div className="space-y-3">
                <button
                  onClick={handleReLogin}
                  className="btn btn-primary w-full"
                >
                  重新登录
                </button>
                <button
                  onClick={handleBackToSettings}
                  className="btn btn-secondary w-full"
                >
                  返回设置
                </button>
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-accent-50 p-4">
        <div className="w-full max-w-md">
          {/* 页面头部 */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-500 to-accent-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-neutral-900 mb-2">修改密码</h1>
            <p className="text-neutral-600">为了账户安全，请输入当前密码并设置新密码</p>
          </div>

          {/* 密码修改表单 */}
          <div className="card p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* 当前密码 */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-neutral-700">
                  当前密码
                </label>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="input pl-11"
                    placeholder="输入当前密码"
                    required
                    disabled={changePassword.isPending}
                  />
                </div>
              </div>

              {/* 新密码 */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-neutral-700">
                  新密码
                </label>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input pl-11"
                    placeholder="输入新密码"
                    required
                    disabled={changePassword.isPending}
                  />
                </div>
                {/* 密码强度指示器 */}
                {newPassword && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className={`h-2 w-full rounded-full ${
                      passwordStrength.level === 'weak' ? 'bg-red-200' :
                      passwordStrength.level === 'medium' ? 'bg-yellow-200' : 'bg-green-200'
                    }`}>
                      <div className={`h-full rounded-full transition-all duration-300 ${
                        passwordStrength.level === 'weak' ? 'w-1/3 bg-red-500' :
                        passwordStrength.level === 'medium' ? 'w-2/3 bg-yellow-500' : 'w-full bg-green-500'
                      }`} />
                    </div>
                    <span className={`text-xs font-medium ${
                      passwordStrength.level === 'weak' ? 'text-red-600' :
                      passwordStrength.level === 'medium' ? 'text-yellow-600' : 'text-green-600'
                    }`}>
                      {passwordStrength.text}
                    </span>
                  </div>
                )}
              </div>

              {/* 确认新密码 */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-neutral-700">
                  确认新密码
                </label>
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`input pl-11 ${
                      confirmPassword && !isPasswordMatch ? 'border-red-300 focus:border-red-500' : ''
                    }`}
                    placeholder="再次输入新密码"
                    required
                    disabled={changePassword.isPending}
                  />
                  {/* 密码匹配状态 */}
                  {confirmPassword && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      {isPasswordMatch ? (
                        <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </div>
                  )}
                </div>
                {confirmPassword && !isPasswordMatch && (
                  <p className="text-sm text-red-600">密码不匹配</p>
                )}
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="bg-error-50 border border-error-200 rounded-xl p-4 flex items-start gap-3">
                  <svg className="w-5 h-5 text-error-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-medium text-error-800">修改失败</h4>
                    <p className="text-sm text-error-700 mt-1">{error}</p>
                  </div>
                </div>
              )}

              {/* 操作按钮 */}
              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="btn btn-primary btn-lg w-full disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {changePassword.isPending ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      修改中...
                    </>
                  ) : (
                    '确认修改'
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleBackToSettings}
                  className="btn btn-secondary w-full"
                  disabled={changePassword.isPending}
                >
                  取消
                </button>
              </div>
            </form>
          </div>

          {/* 返回链接 */}
          <div className="text-center mt-6">
            <button
              onClick={handleBackToSettings}
              className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
              disabled={changePassword.isPending}
            >
              ← 返回用户设置
            </button>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}