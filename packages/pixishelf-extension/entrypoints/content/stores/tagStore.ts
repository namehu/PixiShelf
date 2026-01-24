import { create } from 'zustand'

interface DownloadProgress {
  current: number
  total: number
  isDownloading: boolean
}

interface TaskState {
  // 运行时状态
  isRunning: boolean
  isPaused: boolean
  tagInput: string
  downloadProgress: DownloadProgress

  // 状态操作方法
  setTaskStatus: (status: { isRunning?: boolean; isPaused?: boolean }) => void
  setTagInput: (input: string) => void
  setDownloadProgress: (progress: Partial<DownloadProgress>) => void
  resetTaskState: () => void
}

const initialDownloadProgress: DownloadProgress = {
  current: 0,
  total: 0,
  isDownloading: false
}

export const useTagStore = create<TaskState>((set) => ({
  // 运行时状态
  isRunning: false,
  isPaused: false,
  tagInput: '',
  downloadProgress: initialDownloadProgress,

  // 状态操作方法
  setTaskStatus: (status) => {
    set((state) => ({
      isRunning: status.isRunning ?? state.isRunning,
      isPaused: status.isPaused ?? state.isPaused
    }))
  },

  setTagInput: (input) => {
    set({ tagInput: input })
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
      tagInput: '',
      downloadProgress: initialDownloadProgress
    })
  }
}))
