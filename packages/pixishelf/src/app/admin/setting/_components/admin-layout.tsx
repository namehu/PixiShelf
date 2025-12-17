'use client'

import React, { useState } from 'react'
import { useResponsive } from '@/hooks/use-responsive'
import { AdminTab, AdminTabId, useAdminTab } from '../_hooks/use-admin-tab'
import AdminSidebar from './admin-sidebar'
import ScanManagement from './scan-management'
import UserManagement from './user-management'
import TagManagement from './tag-management'
import { MenuIcon } from 'lucide-react'
import PNav from '@/components/layout/PNav'

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
function AdminLayout() {
  const { activeTab, setActiveTab: onTabChange, tabs } = useAdminTab()

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
      case 'users':
        return <UserManagement />
      case 'tags':
        return <TagManagement />
      default:
        return <ScanManagement />
    }
  }

  return (
    <div className="flex flex-col h-full min-h-screen bg-neutral-50">
      <PNav renderLeft={isMobile && <MenuIcon size={24} onClick={() => setSidebarOpen((pre) => !pre)} />}>
        {isMobile && (
          <h1 className="text-lg font-semibold text-neutral-900 text-center">
            {tabs.find((tab) => tab.id === activeTab)?.label || '管理页面'}
          </h1>
        )}
      </PNav>

      <div className="flex flex-1 ">
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
          <main className="flex-1 overflow-auto">
            <div className="h-full">{renderTabContent()}</div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default AdminLayout
