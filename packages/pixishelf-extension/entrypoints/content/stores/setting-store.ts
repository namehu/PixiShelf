import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import localforage from 'localforage'
import { ETagDownloadMode } from '@/enums/ETagDownloadMode'

interface SettingState {
  // 标签下载模式
  tagDownloadMode: ETagDownloadMode
  // 自定义目录
  customDirectory: string
  // 更新下载模式
  updateTagDownloadMode: (mode: ETagDownloadMode) => void
  // 更新自定义目录
  updateCustomDirectory: (dir: string) => void
}

// 配置 localforage 实例
const settingStorage = localforage.createInstance({
  name: 'pixiv-extension',
  storeName: 'setting-store'
})

export const useSettingStore = create<SettingState>()(
  persist(
    (set) => ({
      tagDownloadMode: ETagDownloadMode.individual,
      customDirectory: '',
      updateTagDownloadMode: (mode: ETagDownloadMode) => set({ tagDownloadMode: mode }),
      updateCustomDirectory: (dir: string) => set({ customDirectory: dir })
    }),
    {
      name: 'pixiv-setting-store',
      storage: settingStorage,
      // 只持久化数据状态，排除方法函数
      partialize: (state) => ({
        tagDownloadMode: state.tagDownloadMode,
        customDirectory: state.customDirectory
      })
    }
  )
)
