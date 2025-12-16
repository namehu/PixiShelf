import { TArtworkResponseDto } from '@/schemas/artwork.dto'
import { create } from 'zustand'

interface ArtworkStoreState {
  total: number
  currentIndex: number
  images: TArtworkResponseDto['images']
  setTotal: (total: number) => void
  setCurrentIndex: (index: number) => void

  setImages: (images: TArtworkResponseDto['images']) => void
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
