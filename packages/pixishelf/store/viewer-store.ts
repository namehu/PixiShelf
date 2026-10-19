import { createJSONStorage, persist } from 'zustand/middleware'
import { create } from 'zustand'
import { RandomImageItem } from '@/types/images'
import { EMediaType } from '@/enums/e-media-type'

export const VIEWER_AUTO_INTERVALS = [3, 5, 10, 15] as const
export type ViewerAutoStatus = 'off' | 'running' | 'paused' | 'ended'
export type ViewerAutoPauseReason = 'user' | 'panel' | 'background' | 'media-error' | 'page-error'

/**
 * 查看器页面状态接口定义
 */
export interface ViewerState {
  autoBrowseStatus: ViewerAutoStatus
  autoBrowseInterval: number
  autoBrowseWait: 'media' | 'page' | null
  autoBrowsePauseReason: ViewerAutoPauseReason | null
  autoBrowseStartRequested: boolean
  autoBrowseSession: number
  autoBrowseRestartSequence: number
  autoBrowseRestart: { mediaId: number; revision: number; consumed: boolean } | null
  requestAutoBrowse: () => void
  runAutoBrowse: () => void
  pauseAutoBrowse: (reason: ViewerAutoPauseReason) => void
  stopAutoBrowse: (ended?: boolean) => void
  setAutoBrowseInterval: (seconds: number) => void
  setAutoBrowseWait: (wait: 'media' | 'page' | null) => void
  restartAutoBrowseMedia: (mediaId: number) => void
  consumeAutoBrowseRestart: (revision: number) => void
  // 数据状态
  images: RandomImageItem[]
  artworkLikeMap: Map<number, boolean>
  hasFetchedOnce: boolean
  // 本地持久化状态是否已完成复原（hydration）
  hasHydrated: boolean

  // UI 状态
  verticalIndex: number
  horizontalIndexes: Record<string, number>
  isChromeHidden: boolean

  // 最大图片数量配置
  maxImageCount: number
  mediaType: EMediaType

  // 状态操作方法
  setImages: (images: RandomImageItem[]) => void
  setVerticalIndex: (index: number) => void
  setHorizontalIndex: (imageKey: string, index: number) => void
  resetViewerState: () => void
  setChromeHidden: (isChromeHidden: boolean) => void
  toggleChromeHidden: () => void
  setMaxImageCount: (count: number) => void
  setMediaType: (mediaType: EMediaType) => void
  setHasHydrated: (value: boolean) => void

  // 批量更新方法
  updateViewerState: (updates: Partial<Pick<ViewerState, 'images' | 'verticalIndex' | 'horizontalIndexes'>>) => void
  /**
   * 同步单个图片点赞状态（通常用于 Server Action 成功后的状态校准）
   * @param artworkId 图片 ID
   * @param isLiked 是否已点赞
   */
  syncImageLikeStatus(artworkId: number, isLiked: boolean): void
}

/**
 * 查看器页面全局状态仓库
 *
 * 功能：
 * - 管理图片列表数据
 * - 追踪垂直滑动位置（当前查看的图片索引）
 * - 追踪每个图集的水平滑动位置
 * - 提供状态重置和批量更新功能
 */
export const useViewerStore = create<ViewerState>()(
  persist(
    (set, get) => ({
      autoBrowseStatus: 'off',
      autoBrowseInterval: 5,
      autoBrowseWait: null,
      autoBrowsePauseReason: null,
      autoBrowseStartRequested: false,
      autoBrowseSession: 0,
      autoBrowseRestartSequence: 0,
      autoBrowseRestart: null,
      requestAutoBrowse: () =>
        set((state) => ({
          autoBrowseStartRequested: true,
          autoBrowseSession:
            state.autoBrowseSession + (state.autoBrowseStatus === 'off' || state.autoBrowseStatus === 'ended' ? 1 : 0)
        })),
      runAutoBrowse: () =>
        set({ autoBrowseStatus: 'running', autoBrowseStartRequested: false, autoBrowsePauseReason: null }),
      pauseAutoBrowse: (reason) => {
        if (get().autoBrowseStatus === 'off' || get().autoBrowseStatus === 'ended') return
        set({ autoBrowseStatus: 'paused', autoBrowsePauseReason: reason, autoBrowseStartRequested: false })
      },
      stopAutoBrowse: (ended = false) =>
        set((state) => ({
          autoBrowseStatus: ended ? 'ended' : 'off',
          autoBrowseWait: null,
          autoBrowsePauseReason: null,
          autoBrowseStartRequested: false,
          autoBrowseSession: state.autoBrowseSession + 1,
          autoBrowseRestart: null
        })),
      setAutoBrowseInterval: (seconds) => {
        if (VIEWER_AUTO_INTERVALS.some((value) => value === seconds)) set({ autoBrowseInterval: seconds })
      },
      setAutoBrowseWait: (wait) => {
        if (get().autoBrowseWait !== wait) set({ autoBrowseWait: wait })
      },
      restartAutoBrowseMedia: (mediaId) =>
        set((state) => ({
          autoBrowseRestartSequence: state.autoBrowseRestartSequence + 1,
          autoBrowseRestart: { mediaId, revision: state.autoBrowseRestartSequence + 1, consumed: false }
        })),
      consumeAutoBrowseRestart: (revision) => {
        const restart = get().autoBrowseRestart
        if (restart?.revision === revision && !restart.consumed) {
          set({ autoBrowseRestart: { ...restart, consumed: true } })
        }
      },
      // 初始状态
      images: [],
      artworkLikeMap: new Map(),
      hasFetchedOnce: false,
      hasHydrated: false,
      verticalIndex: 0,
      horizontalIndexes: {},
      isChromeHidden: false,
      maxImageCount: 8, // 默认最大图片数量
      mediaType: EMediaType.all,
      // 设置图片列表数据
      setImages: (images: RandomImageItem[]) => {
        const map = get().artworkLikeMap
        images.forEach((image) => {
          map.set(image.id, image.isLike ?? false)
        })
        set({
          images,
          artworkLikeMap: map,
          hasFetchedOnce: true
        })
      },

      setChromeHidden: (isChromeHidden: boolean) => {
        set({ isChromeHidden })
      },

      toggleChromeHidden: () => {
        set((state) => ({ isChromeHidden: !state.isChromeHidden }))
      },

      // 设置最大图片数量
      setMaxImageCount: (count: number) => {
        // 确保数值在有效范围内
        const validCount = Math.min(Math.max(1, count), 100)
        set({ maxImageCount: validCount })
      },

      // 设置媒体类型
      setMediaType: (mediaType: EMediaType) => set({ mediaType }),

      // 标记持久化数据已复原
      setHasHydrated: (value: boolean) => set({ hasHydrated: value }),

      // 设置垂直滑动索引
      setVerticalIndex: (index: number) => {
        // 确保索引在有效范围内
        const { images } = get()
        const validIndex = Math.max(0, Math.min(index, images.length - 1))
        set({ verticalIndex: validIndex })
      },

      // 设置特定图集的水平滑动索引
      setHorizontalIndex: (imageKey: string, index: number) => {
        set((state) => ({
          horizontalIndexes: {
            ...state.horizontalIndexes,
            [imageKey]: Math.max(0, index) // 确保索引非负
          }
        }))
      },

      // 重置所有状态
      resetViewerState: () => {
        get().stopAutoBrowse()
        set({
          images: [],
          hasFetchedOnce: false,
          verticalIndex: 0,
          horizontalIndexes: {},
          isChromeHidden: false
        })
      },

      // 批量更新状态（用于状态恢复等场景）
      updateViewerState: (updates) => {
        set((state) => ({
          ...state,
          ...updates
        }))
      },

      syncImageLikeStatus: (artworkId: number, isLiked: boolean) => {
        set((state) => {
          const newMap = new Map(state.artworkLikeMap)
          newMap.set(artworkId, isLiked)
          // 同时更新 images 数组中的状态，保持数据一致性
          const newImages = state.images.map((img) => (img.id === artworkId ? { ...img, isLike: isLiked } : img))
          return { artworkLikeMap: newMap, images: newImages }
        })
      }
    }),
    {
      name: 'pixishelf-viewer-settings',
      storage: createJSONStorage(() => localStorage),
      // 持久化数据复原完成后，标记 hasHydrated 为 true（不直接引用 store 变量，避免 TDZ）
      onRehydrateStorage: () => {
        return (state) => {
          try {
            state?.setHasHydrated?.(true)
          } catch (_) {
            // 忽略无法解析的旧持久化状态。
          }
        }
      },
      partialize: (state) => ({
        autoBrowseInterval: state.autoBrowseInterval,
        maxImageCount: state.maxImageCount,
        mediaType: state.mediaType
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<ViewerState> | undefined
        return {
          ...current,
          ...(saved?.maxImageCount !== undefined ? { maxImageCount: saved.maxImageCount } : {}),
          ...(saved?.mediaType !== undefined ? { mediaType: saved.mediaType } : {}),
          autoBrowseInterval: VIEWER_AUTO_INTERVALS.some((value) => value === saved?.autoBrowseInterval)
            ? saved!.autoBrowseInterval!
            : 5
        }
      }
    }
  )
)
