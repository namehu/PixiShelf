import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

// Tab类型定义
export type AdminTabId = 'scan' | 'users'

export interface AdminTab {
  id: AdminTabId
  label: string
  icon?: React.ComponentType<{ className?: string }>
}

// Hook返回类型
export interface UseAdminTabReturn {
  activeTab: AdminTabId
  setActiveTab: (tabId: AdminTabId) => void
  tabs: AdminTab[]
}

// Tab配置
const ADMIN_TABS: AdminTab[] = [
  {
    id: 'scan',
    label: '扫描管理'
  },
  {
    id: 'users',
    label: '用户管理'
  }
]

// 默认Tab
const DEFAULT_TAB: AdminTabId = 'scan'

/**
 * 管理页面Tab状态Hook
 *
 * 功能：
 * - 管理当前激活的Tab状态
 * - 与URL参数同步Tab状态
 * - 提供Tab切换功能
 * - 处理无效Tab参数的容错
 *
 * @returns {UseAdminTabReturn} Tab状态和操作方法
 */
export function useAdminTab(): UseAdminTabReturn {
  const [searchParams, setSearchParams] = useSearchParams()

  // 从URL参数获取当前Tab，如果无效则使用默认值
  const activeTab = useMemo((): AdminTabId => {
    const tabParam = searchParams.get('tab') as AdminTabId

    // 验证Tab参数是否有效
    const isValidTab = ADMIN_TABS.some((tab) => tab.id === tabParam)

    return isValidTab ? tabParam : DEFAULT_TAB
  }, [searchParams])

  // Tab切换函数
  const setActiveTab = useCallback(
    (tabId: AdminTabId) => {
      // 验证Tab ID是否有效
      const isValidTab = ADMIN_TABS.some((tab) => tab.id === tabId)

      if (!isValidTab) {
        console.warn(`Invalid tab ID: ${tabId}. Using default tab: ${DEFAULT_TAB}`)
        tabId = DEFAULT_TAB
      }

      // 更新URL参数
      const newParams = new URLSearchParams(searchParams)

      if (tabId === DEFAULT_TAB) {
        // 如果是默认Tab，移除参数保持URL简洁
        newParams.delete('tab')
      } else {
        // 设置Tab参数
        newParams.set('tab', tabId)
      }

      setSearchParams(newParams)
    },
    [searchParams, setSearchParams]
  )

  return {
    activeTab,
    setActiveTab,
    tabs: ADMIN_TABS
  }
}

// 导出Tab相关常量供其他组件使用
export { ADMIN_TABS, DEFAULT_TAB }
