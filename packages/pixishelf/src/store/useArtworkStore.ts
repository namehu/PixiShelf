import { create } from 'zustand'

interface ArtworkStoreState {
  total: number
  currentIndex: number // 当前在视口中心的图片索引
  setTotal: (total: number) => void
  setCurrentIndex: (index: number) => void
}

export const useArtworkStore = create<ArtworkStoreState>((set) => ({
  total: 0,
  currentIndex: 0,
  setTotal: (total) => set({ total }),
  setCurrentIndex: (index) => set({ currentIndex: index })
}))
