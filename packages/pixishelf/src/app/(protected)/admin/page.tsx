'use client'

import React, { Suspense } from 'react'
import { useAdminTab } from '@/hooks/admin/use-admin-tab'
import AdminLayout from '@/components/admin/admin-layout'

/**
 * 管理页面主组件
 *
 * 功能：
 * - 作为管理页面的主入口
 * - 管理Tab状态和URL参数同步
 * - 提供统一的管理页面布局
 * - 处理路由参数和页面状态
 *
 * 路由：
 * - /admin - 默认显示扫描管理
 * - /admin?tab=scan - 显示扫描管理
 * - /admin?tab=users - 显示用户管理
 */
function AdminPageContent() {
  // 使用Tab状态管理Hook
  const { activeTab, setActiveTab, tabs } = useAdminTab()

  return <AdminLayout activeTab={activeTab} onTabChange={setActiveTab} tabs={tabs} />
}

function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-neutral-600">加载中...</p>
          </div>
        </div>
      }
    >
      <AdminPageContent />
    </Suspense>
  )
}

export default AdminPage
