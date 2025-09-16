'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components'
import { Button } from '@/components/ui'
import { ROUTES } from '@/lib/constants'

// ============================================================================
// 主页面
// ============================================================================

/**
 * 主页面组件
 */
export default function HomePage() {
  const router = useRouter()
  const { isAuthenticated, isLoading, user, logout } = useAuth()

  /**
   * 处理登出
   */
  const handleLogout = async () => {
    await logout()
  }

  /**
   * 跳转到登录页
   */
  const handleGoToLogin = () => {
    router.push(ROUTES.LOGIN)
  }

  // 加载状态
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 导航栏 */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">
                Artisan Shelf
              </h1>
            </div>
            
            <div className="flex items-center space-x-4">
              {isAuthenticated ? (
                <>
                  <span className="text-sm text-gray-700">
                    欢迎，{user?.username}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLogout}
                  >
                    登出
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleGoToLogin}
                >
                  登录
                </Button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* 主要内容 */}
      <main className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            欢迎来到 Artisan Shelf
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            专为艺术家设计的作品管理和展示平台
          </p>

          {/* TailwindCSS 样式测试区域 */}
          <div className="mb-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">样式测试</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
              <div className="bg-red-500 text-white p-4 rounded-lg text-center">
                红色背景
              </div>
              <div className="bg-blue-500 text-white p-4 rounded-lg text-center">
                蓝色背景
              </div>
              <div className="bg-green-500 text-white p-4 rounded-lg text-center">
                绿色背景
              </div>
            </div>
            <div className="mt-4 space-x-2 text-center">
              <span className="inline-block bg-primary text-white px-3 py-1 rounded">Primary</span>
              <span className="inline-block bg-accent text-white px-3 py-1 rounded">Accent</span>
              <span className="inline-block bg-neutral-500 text-white px-3 py-1 rounded">Neutral</span>
            </div>
          </div>

          {isAuthenticated ? (
            <div className="bg-white rounded-lg shadow p-6 max-w-md mx-auto">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                登录状态
              </h3>
              <div className="space-y-2 text-sm text-gray-600">
                <p><strong>用户ID:</strong> {user?.id}</p>
                <p><strong>用户名:</strong> {user?.username}</p>
                <p><strong>登录状态:</strong> 已登录</p>
              </div>
              <div className="mt-6 space-y-3">
                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => router.push('/dashboard')}
                >
                  进入仪表板
                </Button>
                <Button
                  variant="outline"
                  fullWidth
                  onClick={handleLogout}
                >
                  登出
                </Button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow p-6 max-w-md mx-auto">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                开始使用
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                请登录您的账户以访问完整功能
              </p>
              <Button
                variant="primary"
                fullWidth
                onClick={handleGoToLogin}
              >
                立即登录
              </Button>
            </div>
          )}
        </div>
      </main>

      {/* 页脚 */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <div className="text-center text-sm text-gray-500">
            <p>&copy; 2024 Artisan Shelf. 保留所有权利。</p>
          </div>
        </div>
      </footer>
    </div>
  )
}