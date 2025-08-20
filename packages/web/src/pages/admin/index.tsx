import React from 'react'
import { useAdminTab } from './hooks/use-admin-tab'
import AdminLayout from './components/admin-layout'

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
function AdminPage() {
  // 使用Tab状态管理Hook
  const { activeTab, setActiveTab, tabs } = useAdminTab()
  
  return (
    <div className="min-h-full">
      <AdminLayout
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={tabs}
      />
    </div>
  )
}

export default AdminPage