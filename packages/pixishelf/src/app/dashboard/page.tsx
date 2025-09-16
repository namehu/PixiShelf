'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components'
import { Button, Card, CardHeader, CardTitle, CardContent } from '@/components/ui'
import { ROUTES } from '@/lib/constants'

// ============================================================================
// 仪表板页面
// ============================================================================

/**
 * 仪表板页面组件
 */
export default function DashboardPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading, user, logout } = useAuth()

  /**
   * 处理登出
   */
  const handleLogout = async () => {
    await logout()
  }

  /**
   * 返回主页
   */
  const handleGoHome = () => {
    router.push('/')
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

  // 未认证状态
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center">访问受限</CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              您需要登录才能访问仪表板
            </p>
            <Button
              variant="primary"
              fullWidth
              onClick={() => router.push(ROUTES.LOGIN)}
            >
              前往登录
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 导航栏 */}
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-bold text-gray-900">
                Artisan Shelf
              </h1>
              <span className="text-sm text-gray-500">/ 仪表板</span>
            </div>
            
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">
                {user?.username}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGoHome}
              >
                主页
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
              >
                登出
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* 主要内容 */}
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* 欢迎区域 */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            欢迎回来，{user?.username}！
          </h2>
          <p className="text-gray-600">
            这是您的个人仪表板，您可以在这里管理您的作品和设置。
          </p>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                总作品数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">0</div>
              <p className="text-xs text-gray-500 mt-1">暂无作品</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                收藏数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">0</div>
              <p className="text-xs text-gray-500 mt-1">暂无收藏</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                浏览量
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">0</div>
              <p className="text-xs text-gray-500 mt-1">暂无浏览</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-gray-600">
                标签数
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-900">0</div>
              <p className="text-xs text-gray-500 mt-1">暂无标签</p>
            </CardContent>
          </Card>
        </div>

        {/* 快速操作 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>快速操作</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="primary" fullWidth>
                上传新作品
              </Button>
              <Button variant="outline" fullWidth>
                管理作品集
              </Button>
              <Button variant="outline" fullWidth>
                查看统计
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>账户信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">用户ID:</span>
                  <span className="font-mono text-xs">{user?.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">用户名:</span>
                  <span>{user?.username}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">注册时间:</span>
                  <span>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString('zh-CN') : '未知'}</span>
                </div>
              </div>
              <div className="pt-3 border-t">
                <Button variant="outline" size="sm" fullWidth>
                  编辑个人资料
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}