import { create } from 'zustand'

interface ArtworkTaskState {
  // 运行时状态
  isRunning: boolean
  isPaused: boolean
  artworkInput: string

  // Actions
  setTaskStatus: (status: { isRunning?: boolean; isPaused?: boolean }) => void
  setArtworkInput: (input: string) => void
  resetTaskState: () => void
}

export const useArtworkTaskStore = create<ArtworkTaskState>((set) => ({
  // 运行时状态
  isRunning: false,
  isPaused: false,
  artworkInput: '',

  // Actions
  setTaskStatus: (status) => {
    set((state) => ({
      isRunning: status.isRunning ?? state.isRunning,
      isPaused: status.isPaused ?? state.isPaused
    }))
  },

  setArtworkInput: (input) => {
    set({ artworkInput: input })
  },

  resetTaskState: () => {
    set({
      isRunning: false,
      isPaused: false,
      artworkInput: ''
    })
  }
}))
