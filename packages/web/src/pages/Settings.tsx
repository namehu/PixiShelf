import React from 'react'
import { useNavigate } from 'react-router-dom'
import { PageContainer } from '../components/PageContainer'

export default function Settings() {
  const navigate = useNavigate()

  const handleChangePassword = () => {
    navigate('/settings/password')
  }

  return (
    <PageContainer>
      <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-accent-50 p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* 页面标题 */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-neutral-900 mb-2">
              用户设置
            </h1>
            <p className="text-neutral-600">
              管理你的账户设置和个人偏好
            </p>
          </div>

          {/* 密码管理区域 */}
          <div className="card p-6">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-neutral-900 mb-2">
                密码管理
              </h2>
              <p className="text-neutral-600">
                修改你的账户密码以保护账户安全
              </p>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl border border-neutral-200 bg-neutral-50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-accent-500 rounded-xl flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-medium text-neutral-900">账户密码</h3>
                  <p className="text-sm text-neutral-600">上次修改时间：从未修改</p>
                </div>
              </div>
              <button
                onClick={handleChangePassword}
                className="btn btn-primary"
              >
                修改密码
              </button>
            </div>
          </div>

          {/* 账户信息区域 */}
          <div className="card p-6">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-neutral-900 mb-2">
                账户信息
              </h2>
              <p className="text-neutral-600">
                查看你的基本账户信息
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl border border-neutral-200">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-primary-500 to-accent-500 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-medium text-neutral-900">用户名</h3>
                    <p className="text-sm text-neutral-600">你的登录用户名</p>
                  </div>
                </div>
                <div className="text-neutral-700 font-medium">
                  {/* 这里可以从用户上下文获取用户名 */}
                  当前用户
                </div>
              </div>
            </div>
          </div>

          {/* 返回按钮 */}
          <div className="flex justify-center pt-6">
            <button
              onClick={() => navigate('/')}
              className="btn btn-secondary"
            >
              返回首页
            </button>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}