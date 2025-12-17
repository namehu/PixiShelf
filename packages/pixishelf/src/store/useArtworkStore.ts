import { TArtworkImageDto } from '@/schemas/artwork.dto'
import { create } from 'zustand'

interface ArtworkStoreState {
  /**
   * 作品图片总数
   */
  total: number
  /**
   * 当前显示的图片索引
   */
  currentIndex: number
  /**
   * 作品图片列表
   */
  images: TArtworkImageDto[]
  /**
   * 设置作品图片总数
   */
  setTotal: (total: number) => void
  /**
   * 设置当前显示的图片索引
   */
  setCurrentIndex: (index: number) => void
  /**
   * 设置作品图片列表
   */
  setImages: (images: TArtworkImageDto[]) => void
  /**
   * 清空作品图片列表
   */
  clearImages: () => void
}

export const useArtworkStore = create<ArtworkStoreState>((set) => ({
  total: 0,
  currentIndex: 0,
  images: [],
  setTotal: (total) => set({ total }),
  setCurrentIndex: (index) => set({ currentIndex: index }),
  setImages: (images) => set({ images }),
  clearImages: () => set({ images: [] })
}))
