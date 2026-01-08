'use client'

import React from 'react'
import { AdminTab, AdminTabId } from '../_hooks/use-admin-tab'
import { APP_VERSION } from '@/_config'

// 侧边栏组件Props接口
export interface AdminSidebarProps {
  /** Tab配置列表 */
  tabs: AdminTab[]
  /** 当前激活的Tab */
  activeTab: AdminTabId
  /** Tab切换回调 */
  onTabChange: (tabId: AdminTabId) => void
  /** 是否为移动端 */
  isMobile: boolean
  /** 是否显示侧边栏 */
  isOpen: boolean
  /** 关闭侧边栏回调（仅移动端） */
  onClose: () => void
}

/**
 * 管理页面侧边栏组件
 *
 * 功能：
 * - 渲染Tab导航列表
 * - 高亮显示当前激活的Tab
 * - 响应式设计（桌面端固定，移动端抽屉式）
 * - 支持键盘导航
 * - 提供良好的视觉反馈
 *
 * 样式特点：
 * - 桌面端：固定在左侧，宽度280px
 * - 移动端：抽屉式，从左侧滑入
 * - 激活状态：蓝色背景和文字
 * - 悬停状态：浅灰色背景
 */
function AdminSidebar({ tabs, activeTab, onTabChange, isMobile, isOpen, onClose }: AdminSidebarProps) {
  // 处理Tab点击
  const handleTabClick = (tabId: AdminTabId) => {
    onTabChange(tabId)
  }

  // 处理键盘导航
  const handleKeyDown = (event: React.KeyboardEvent, tabId: AdminTabId) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleTabClick(tabId)
    }
  }

  // 侧边栏样式
  const sidebarClasses = [
    'bg-white border-r border-neutral-100 flex flex-col shadow-[1px_0_20px_rgba(0,0,0,0.02)]',
    isMobile
      ? `fixed top-0 left-0 h-full w-64 z-40 transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`
      : 'w-64 h-full'
  ].join(' ')

  return (
    <aside className={sidebarClasses}>
      {/* 侧边栏头部 */}
      <div className="h-16 flex items-center px-6 border-b border-neutral-100">
        <div className="flex items-center justify-between w-full">
          <h2 className="text-base font-bold text-neutral-800 tracking-tight">管理中心</h2>

          {/* 移动端关闭按钮 */}
          {isMobile && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-600 hover:bg-neutral-50 transition-colors"
              aria-label="关闭导航菜单"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 p-3 space-y-1" role="navigation" aria-label="管理页面导航">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabClick(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, tab.id)}
              className={[
                'w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 group relative',
                'focus:outline-none focus:ring-2 focus:ring-primary-500/20',
                isActive
                  ? 'bg-primary-50/50 text-primary-600'
                  : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
              ].join(' ')}
              aria-current={isActive ? 'page' : undefined}
            >
              {/* Tab图标（如果有） */}
              {tab.icon && (
                <tab.icon
                  className={[
                    'w-4 h-4 mr-3 flex-shrink-0 transition-colors',
                    isActive ? 'text-primary-600' : 'text-neutral-400 group-hover:text-neutral-600'
                  ].join(' ')}
                />
              )}

              {/* Tab标签 */}
              <span>{tab.label}</span>

              {/* 激活状态指示器 */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary-500 rounded-r-full opacity-0" />
              )}
            </button>
          )
        })}
      </nav>

      {/* 侧边栏底部 */}
      <div className="p-4 border-t border-neutral-100">
        <div className="text-[10px] font-medium text-neutral-400 text-center tracking-wider uppercase">
          PixiShelf Admin {APP_VERSION}
        </div>
      </div>
    </aside>
  )
}

export default AdminSidebar
