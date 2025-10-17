import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import localforage from 'localforage'

interface Position {
  x: number
  y: number
}

interface UIState {
  // 面板显示状态
  isVisible: boolean
  isCollapsed: boolean
  position: Position

  // 当前活动标签
  activeTab: 'tags' | 'users' | 'artworks'

  // 操作方法
  setPosition: (position: Position) => void
  toggleVisibility: () => void
  toggleCollapse: () => void
  setActiveTab: (tab: 'tags' | 'users' | 'artworks') => void

  // 初始化位置（保持向后兼容）
  initializePosition: () => void
}

// 配置 localforage 实例
const uiStorage = localforage.createInstance({
  name: 'pixiv-extension',
  storeName: 'ui-store'
})

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      isVisible: false,
      isCollapsed: false,
      position: { x: 20, y: 20 },
      activeTab: 'tags',

      setPosition: (position) => {
        set({ position })
      },

      toggleVisibility: () => {
        set((state) => ({ isVisible: !state.isVisible }))
      },

      toggleCollapse: () => {
        set((state) => ({ isCollapsed: !state.isCollapsed }))
      },

      setActiveTab: (tab) => {
        set({ activeTab: tab })
      },

      // 保持向后兼容的初始化方法
      initializePosition: async () => {
        try {
          // 尝试从旧的 chrome.storage.local 迁移数据
          if (typeof chrome !== 'undefined' && chrome.storage) {
            const result = await chrome.storage.local.get('pixiv-panel-position')
            if (result['pixiv-panel-position']) {
              set({ position: result['pixiv-panel-position'] })
              // 迁移后清除旧数据
              await chrome.storage.local.remove('pixiv-panel-position')
            }
          }
        } catch (error) {
          console.warn('Failed to migrate panel position from chrome.storage:', error)
        }
      }
    }),
    {
      name: 'pixiv-ui-store',
      storage: uiStorage,
      // 只持久化需要的状态，排除方法
      partialize: (state) => ({
        isVisible: state.isVisible,
        isCollapsed: state.isCollapsed,
        position: state.position,
        activeTab: state.activeTab
      })
    }
  )
)
