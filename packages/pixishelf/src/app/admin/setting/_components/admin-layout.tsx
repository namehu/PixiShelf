'use client'

import React, { useState } from 'react'
import { useResponsive } from '@/hooks/use-responsive'
import { AdminTab, AdminTabId } from '../_hooks/use-admin-tab'
import AdminSidebar from './admin-sidebar'
import ScanManagement from './scan-management'
import UserManagement from './user-management'
import TagManagement from './tag-management'
import TestSSE from './test-sse'

// 布局组件Props接口
export interface AdminLayoutProps {
  /** 当前激活的Tab */
  activeTab: AdminTabId
  /** Tab切换回调 */
  onTabChange: (tabId: AdminTabId) => void
  /** Tab配置列表 */
  tabs: AdminTab[]
}

/**
 * 管理页面布局组件
 *
 * 功能：
 * - 实现响应式布局（桌面端固定侧边栏，移动端抽屉式）
 * - 管理侧边栏的显示和隐藏
 * - 根据当前Tab渲染对应的内容组件
 * - 处理移动端的导航交互
 *
 * 布局策略：
 * - 桌面端（≥768px）：左侧固定侧边栏 + 右侧内容区域
 * - 移动端（<768px）：抽屉式侧边栏，默认隐藏
 */
function AdminLayout({ activeTab, onTabChange, tabs }: AdminLayoutProps) {
  const { isMobile } = useResponsive()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // 处理Tab切换
  const handleTabChange = (tabId: AdminTabId) => {
    onTabChange(tabId)
    // 移动端切换Tab后关闭侧边栏
    if (isMobile) {
      setSidebarOpen(false)
    }
  }

  // 渲染当前Tab的内容
  const renderTabContent = () => {
    switch (activeTab) {
      case 'scan':
        return <ScanManagement />
      case 'users':
        return <UserManagement />
      case 'tags':
        return <TagManagement />
      case 'test-sse':
        return <TestSSE />
      default:
        return <ScanManagement />
    }
  }

  return (
    <div className="flex h-full min-h-screen bg-neutral-50">
      {/* 侧边栏 */}
      <AdminSidebar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isMobile={isMobile}
        isOpen={isMobile ? sidebarOpen : true}
        onClose={() => setSidebarOpen(false)}
      />

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 移动端顶部导航栏 */}
        {isMobile && (
          <div className="bg-white border-b border-neutral-200 px-4 py-3 flex items-center justify-between">
            {/* 汉堡菜单按钮 */}
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="btn-ghost p-2 rounded-lg hover:bg-neutral-100 focus:ring-2 focus:ring-neutral-500"
              aria-label="打开导航菜单"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* 当前页面标题 */}
            <h1 className="text-lg font-semibold text-neutral-900">
              {tabs.find((tab) => tab.id === activeTab)?.label || '管理页面'}
            </h1>

            {/* 占位元素，保持标题居中 */}
            <div className="w-10" />
          </div>
        )}

        {/* 内容区域 */}
        <main className="flex-1 overflow-auto">
          <div className="h-full">{renderTabContent()}</div>
        </main>
      </div>

      {/* 移动端遮罩层 */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  )
}

export default AdminLayout
