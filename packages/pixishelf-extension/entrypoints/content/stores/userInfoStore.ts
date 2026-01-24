import { create } from 'zustand'

interface DownloadProgress {
  current: number
  total: number
  isDownloading: boolean
}

interface UserInfoState {
  // 运行时状态
  isRunning: boolean
  isPaused: boolean
  userInput: string
  downloadProgress: DownloadProgress

  // 状态操作方法
  setTaskStatus: (status: { isRunning?: boolean; isPaused?: boolean }) => void
  setUserInput: (input: string) => void
  setDownloadProgress: (progress: Partial<DownloadProgress>) => void
  resetTaskState: () => void
}

const initialDownloadProgress: DownloadProgress = {
  current: 0,
  total: 0,
  isDownloading: false
}

export const useUserInfoStore = create<UserInfoState>((set) => ({
  // 运行时状态
  isRunning: false,
  isPaused: false,
  userInput: '',
  downloadProgress: initialDownloadProgress,

  // 状态操作方法
  setTaskStatus: (status) => {
    set((state) => ({
      isRunning: status.isRunning ?? state.isRunning,
      isPaused: status.isPaused ?? state.isPaused
    }))
  },

  setUserInput: (input) => {
    set({ userInput: input })
  },

  setDownloadProgress: (progress) => {
    set((state) => ({
      downloadProgress: { ...state.downloadProgress, ...progress }
    }))
  },

  resetTaskState: () => {
    set({
      isRunning: false,
      isPaused: false,
      userInput: '',
      downloadProgress: initialDownloadProgress
    })
  }
}))
