import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const ADMIN_PREFERENCES_STORAGE_KEY = 'pixishelf-admin-preferences'
export type ArchiveUploaderResultView = 'list' | 'preview'

interface AdminPreferencesState {
  /** 艺术家管理页是否展示艺术家图片。 */
  showArtistImages: boolean
  /** 标签管理页是否展示标签封面。 */
  showTagCovers: boolean
  /** 作品管理页是否展示 Pixiv 同步状态列。 */
  showArtworkPixivSync: boolean
  /** 上传者发现结果是否展示远端首图缩略图。 */
  archiveUploaderResultView: ArchiveUploaderResultView
  setShowArtistImages: (show: boolean) => void
  setShowTagCovers: (show: boolean) => void
  setShowArtworkPixivSync: (show: boolean) => void
  setArchiveUploaderResultView: (view: ArchiveUploaderResultView) => void
}

export const useAdminPreferencesStore = create<AdminPreferencesState>()(
  persist(
    (set) => ({
      showArtistImages: true,
      showTagCovers: true,
      showArtworkPixivSync: true,
      archiveUploaderResultView: 'list',
      setShowArtistImages: (showArtistImages) => set({ showArtistImages }),
      setShowTagCovers: (showTagCovers) => set({ showTagCovers }),
      setShowArtworkPixivSync: (showArtworkPixivSync) => set({ showArtworkPixivSync }),
      setArchiveUploaderResultView: (archiveUploaderResultView) => set({ archiveUploaderResultView })
    }),
    {
      name: ADMIN_PREFERENCES_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // 只持久化用户配置；action 是运行时函数，无法也无需写入 localStorage。
      partialize: (state) => ({
        showArtistImages: state.showArtistImages,
        showTagCovers: state.showTagCovers,
        showArtworkPixivSync: state.showArtworkPixivSync,
        archiveUploaderResultView: state.archiveUploaderResultView
      }),
      migrate: (persistedState) => {
        const state = persistedState as Partial<AdminPreferencesState>
        return {
          ...state,
          archiveUploaderResultView: state.archiveUploaderResultView === 'preview' ? 'preview' : 'list'
        } as AdminPreferencesState
      },
      // Next.js 会预渲染客户端组件；挂载后再读取 localStorage，避免 hydration 不一致。
      skipHydration: true
    }
  )
)
