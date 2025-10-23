import { create } from 'zustand'
import { RandomImageItem } from '@/types/images'

/**
 * Viewer 页面状态接口定义
 */
export interface ViewerState {
  // 数据状态
  images: RandomImageItem[]
  hasFetchedOnce: boolean

  // UI 状态
  verticalIndex: number
  horizontalIndexes: Record<string, number>

  // 标题透明度
  titleOpacity: string

  // 最大图片数量配置
  maxImageCount: number

  // 状态操作方法
  setImages: (images: RandomImageItem[]) => void
  setVerticalIndex: (index: number) => void
  setHorizontalIndex: (imageKey: string, index: number) => void
  resetViewerState: () => void
  setTitleOpacity: (titleOpacity: string) => void
  setMaxImageCount: (count: number) => void

  // 批量更新方法
  updateViewerState: (updates: Partial<Pick<ViewerState, 'images' | 'verticalIndex' | 'horizontalIndexes'>>) => void
}

/**
 * Viewer 页面全局状态管理 Store
 *
 * 功能：
 * - 管理图片列表数据
 * - 追踪垂直滑动位置（当前查看的图片索引）
 * - 追踪每个图集的水平滑动位置
 * - 提供状态重置和批量更新功能
 */
export const useViewerStore = create<ViewerState>((set, get) => ({
  // 初始状态
  images: [],
  hasFetchedOnce: false,
  verticalIndex: 0,
  horizontalIndexes: {},
  titleOpacity: '100',
  maxImageCount: 8, // 默认最大图片数量
  // 设置图片列表数据
  setImages: (images: RandomImageItem[]) => {
    set({
      images,
      hasFetchedOnce: true
    })
  },

  // 设置标题透明度
  setTitleOpacity: (titleOpacity: string) => {
    set({ titleOpacity })
  },

  // 设置最大图片数量
  setMaxImageCount: (count: number) => {
    // 确保数值在有效范围内
    const validCount = Math.min(Math.max(1, count), 100)
    set({ maxImageCount: validCount })
  },

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
    set({
      images: [],
      hasFetchedOnce: false,
      verticalIndex: 0,
      horizontalIndexes: {}
    })
  },

  // 批量更新状态（用于状态恢复等场景）
  updateViewerState: (updates) => {
    set((state) => ({
      ...state,
      ...updates
    }))
  }
}))

/**
 * 获取当前图片的水平索引
 * @param imageKey 图片的唯一标识
 * @returns 水平索引，默认为 0
 */
export const getHorizontalIndex = (imageKey: string): number => {
  const { horizontalIndexes } = useViewerStore.getState()
  return horizontalIndexes[imageKey] ?? 0
}

/**
 * 检查是否有缓存的状态数据
 * @returns 是否有可恢复的状态
 */
export const hasViewerCache = (): boolean => {
  const { images, hasFetchedOnce } = useViewerStore.getState()
  return hasFetchedOnce && images.length > 0
}
