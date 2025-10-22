import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import localforage from 'localforage'

interface Position {
  x: number
  y: number
}

export const tabIds = ['tags', 'users', 'artworks', 'setting'] as const
export type TabId = (typeof tabIds)[number]
interface UIState {
  // 面板显示状态
  isVisible: boolean
  isCollapsed: boolean
  position: Position

  // 当前活动标签
  activeTab: TabId

  // 操作方法
  setPosition: (position: Position) => void
  toggleVisibility: () => void
  toggleCollapse: () => void
  setActiveTab: (tab: TabId) => void
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
