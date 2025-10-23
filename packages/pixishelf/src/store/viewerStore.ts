import { create } from 'zustand'
import { RandomImageItem } from '@/types/images'
import { LikeStatus } from '@/services'

/**
 * Viewer 页面状态接口定义
 */
export interface ViewerState {
  // 数据状态
  images: RandomImageItem[]
  artworkLikeMap: Map<number, boolean>
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
  toggleLikeStatus(artworkId: number): Promise<LikeStatus>
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
  artworkLikeMap: new Map(),
  hasFetchedOnce: false,
  verticalIndex: 0,
  horizontalIndexes: {},
  titleOpacity: '100',
  maxImageCount: 8, // 默认最大图片数量
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
  },

  toggleLikeStatus: async (artworkId: number) => {
    const { artworkLikeMap } = get()
    const prevLiked = artworkLikeMap.get(artworkId) ?? false
    const nextLiked = !prevLiked

    // 1) 乐观更新：立即反转点赞状态（Map 和 images 都更新）
    set((state) => {
      const newMap = new Map(state.artworkLikeMap)
      newMap.set(artworkId, nextLiked)
      const newImages = state.images.map((img) => (img.id === artworkId ? { ...img, isLike: nextLiked } : img))
      return { artworkLikeMap: newMap, images: newImages }
    })

    try {
      // 2) 发送后端请求，获取权威状态
      const res = await _toggleLikeStatus(artworkId)
      // const { userLiked } = res;
      // 成功后用后端返回的权威状态矫正（避免并发或服务端规则造成的偏差）
      // set((state) => {
      //   const newMap = new Map(state.artworkLikeMap);
      //   newMap.set(artworkId, userLiked);
      //   const newImages = state.images.map((img) =>
      //     img.id === artworkId ? { ...img, isLike: userLiked } : img
      //   );
      //   return { artworkLikeMap: newMap, images: newImages };
      // });

      return res
    } catch (error) {
      // 3) 失败回滚：恢复到请求前的状态
      console.error('切换点赞状态失败:', error)
      set((state) => {
        const newMap = new Map(state.artworkLikeMap)
        newMap.set(artworkId, prevLiked)
        const newImages = state.images.map((img) => (img.id === artworkId ? { ...img, isLike: prevLiked } : img))
        return { artworkLikeMap: newMap, images: newImages }
      })
      throw error
    }
  }
}))

async function _toggleLikeStatus(artworkId: number): Promise<LikeStatus> {
  const response = await fetch(`/api/artworks/${artworkId}/like`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`切换点赞状态失败: ${response.status}`)
  }

  const result = await response.json()

  if (!result.success) {
    throw new Error(result.error || '切换点赞状态失败')
  }

  return {
    likeCount: result.data.likeCount,
    userLiked: result.data.userLiked
  }
}
