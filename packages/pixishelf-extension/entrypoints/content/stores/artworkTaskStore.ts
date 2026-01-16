
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import localforage from 'localforage'
import { ArtworkStats, ArtworkProgressStorage, ArtworkProgress, PixivArtworkData } from '../../../types/pixiv'

interface DownloadProgress {
  current: number
  total: number
  isDownloading: boolean
}

interface ArtworkTaskState {
  // 原始数据（持久化）
  artworkList: string[]
  progressData: ArtworkProgressStorage
  taskStats: ArtworkStats

  // 运行时状态（不持久化）
  isRunning: boolean
  isPaused: boolean
  downloadProgress: DownloadProgress
  logs: string[]
  artworkInput: string

  // 计算属性（getter，不持久化）
  get successfulArtworks(): Array<{ id: string; data: PixivArtworkData }>
  get failedArtworks(): Array<{ id: string; error: string }>

  // 数据操作方法
  setArtworkList: (ids: string[]) => void
  addArtworks: (input: string) => { added: number; total: number; duplicates: number }
  addArtworkArray: (ids: string[]) => void
  removeArtwork: (id: string) => void
  updateProgress: (id: string, progress: ArtworkProgress) => void
  clearProgress: () => void
  clearAll: () => void
  updateTaskStats: () => void

  // 运行时状态操作方法
  setTaskStatus: (status: { isRunning?: boolean; isPaused?: boolean }) => void
  setDownloadProgress: (progress: Partial<DownloadProgress>) => void
  addLog: (message: string) => void
  clearLogs: () => void
  setArtworkInput: (input: string) => void

  // 重置状态
  resetTaskState: () => void

  // 数据查询方法
  getProgress: () => ArtworkProgressStorage
  getArtworkList: () => string[]
}

const initialDownloadProgress: DownloadProgress = {
  current: 0,
  total: 0,
  isDownloading: false
}

const initialTaskStats: ArtworkStats = {
  total: 0,
  completed: 0,
  successful: 0,
  failed: 0,
  pending: 0
}

// 配置 localforage 实例
const artworkStorage = localforage.createInstance({
  name: 'pixiv-extension',
  storeName: 'artwork-task-store'
})

export const useArtworkTaskStore = create<ArtworkTaskState>()(
  persist(
    (set, get) => {
      // 计算统计信息的辅助函数
      const calculateTaskStats = (list: string[], progressData: ArtworkProgressStorage): ArtworkStats => {
        const total = new Set(list).size
        const completedCount = Object.keys(progressData).length
        const successCount = Object.values(progressData).filter((p) => p.status === 'fulfilled').length
        const errorCount = completedCount - successCount

        return {
          total,
          completed: completedCount,
          successful: successCount,
          failed: errorCount,
          pending: total - completedCount
        }
      }

      return {
        // 原始数据
        artworkList: [],
        progressData: {},
        taskStats: initialTaskStats,

        // 运行时状态
        isRunning: false,
        isPaused: false,
        downloadProgress: initialDownloadProgress,
        logs: [],
        artworkInput: '',

        // 计算属性
        get successfulArtworks(): Array<{ id: string; data: PixivArtworkData }> {
          const state = get()
          return Object.entries(state.progressData)
            .filter(([_, progress]) => progress.status === 'fulfilled')
            .map(([id, progress]) => ({
              id,
              data: progress.data as PixivArtworkData
            }))
        },

        get failedArtworks(): Array<{ id: string; error: string }> {
          const state = get()
          return Object.entries(state.progressData)
            .filter(([_, progress]) => progress.status === 'rejected')
            .map(([id, progress]) => ({
              id,
              error: progress.data as string
            }))
        },

        // 更新统计信息的方法
        updateTaskStats: () => {
          const state = get()
          const newStats = calculateTaskStats(state.artworkList, state.progressData)
          set({ taskStats: newStats })
        },

        // 数据操作方法
        setArtworkList: (ids) => {
          set((state) => {
            const newStats = calculateTaskStats(ids, state.progressData)
            return { artworkList: ids, taskStats: newStats }
          })
        },

        addArtworks: (input: string) => {
          const ids = input
            .split(/[\n,]+/) // Split by newline or comma
            .map((id) => id.trim())
            .filter((id) => id.length > 0 && /^\d+$/.test(id)) // Ensure numeric ID

          if (ids.length === 0) {
            return { added: 0, total: get().artworkList.length, duplicates: 0 }
          }

          const existingIds = get().artworkList
          const newIds = ids.filter((id) => !existingIds.includes(id))
          
          const added = newIds.length
          const duplicates = ids.length - added
          
          if (newIds.length > 0) {
            set((state) => {
              const currentIds = new Set(state.artworkList)
              newIds.forEach((id) => currentIds.add(id))
              const newArtworkList = Array.from(currentIds)
              const newStats = calculateTaskStats(newArtworkList, state.progressData)
              return { artworkList: newArtworkList, taskStats: newStats }
            })
          }

          const total = existingIds.length + added
          return { added, total, duplicates }
        },

        addArtworkArray: (ids) => {
          set((state) => {
            const currentIds = new Set(state.artworkList)
            ids.forEach((id) => currentIds.add(id))
            const newArtworkList = Array.from(currentIds)
            const newStats = calculateTaskStats(newArtworkList, state.progressData)
            return { artworkList: newArtworkList, taskStats: newStats }
          })
        },

        removeArtwork: (id) => {
          set((state) => {
            const newList = state.artworkList.filter((t) => t !== id)
            const newProgressData = { ...state.progressData }
            delete newProgressData[id]
            const newStats = calculateTaskStats(newList, newProgressData)
            return {
              artworkList: newList,
              progressData: newProgressData,
              taskStats: newStats
            }
          })
        },

        updateProgress: (id, progress) => {
          set((state) => {
            const newProgressData = {
              ...state.progressData,
              [id]: progress
            }
            const newStats = calculateTaskStats(state.artworkList, newProgressData)
            return {
              progressData: newProgressData,
              taskStats: newStats
            }
          })
        },

        clearProgress: () => {
          set((state) => {
            const newStats = calculateTaskStats(state.artworkList, {})
            return { progressData: {}, taskStats: newStats }
          })
        },

        clearAll: () => {
          set({
            artworkList: [],
            progressData: {},
            artworkInput: '',
            taskStats: initialTaskStats
          })
        },

        // 运行时状态操作方法
        setTaskStatus: (status) => {
          set((state) => ({
            isRunning: status.isRunning ?? state.isRunning,
            isPaused: status.isPaused ?? state.isPaused
          }))
        },

        setDownloadProgress: (progress) => {
          set((state) => ({
            downloadProgress: { ...state.downloadProgress, ...progress }
          }))
        },

        addLog: (message) => {
          const timestamp = new Date().toLocaleTimeString()
          const logMessage = `[${timestamp}] ${message}`

          set((state) => ({
            logs: [...state.logs, logMessage].slice(-100)
          }))
        },

        clearLogs: () => {
          set({ logs: [] })
        },

        setArtworkInput: (input) => {
          set({ artworkInput: input })
        },

        resetTaskState: () => {
          set({
            isRunning: false,
            isPaused: false,
            downloadProgress: initialDownloadProgress,
            artworkInput: ''
          })
        },

        getProgress: () => {
          return get().progressData
        },

        getArtworkList: () => {
          return get().artworkList
        }
      }
    },
    {
      name: 'pixiv-artwork-task-store',
      storage: artworkStorage,
      partialize: (state) => ({
        artworkList: state.artworkList,
        progressData: state.progressData,
        taskStats: state.taskStats,
        artworkInput: state.artworkInput,
        logs: state.logs.slice(-500)
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.updateTaskStats()
        }
      }
    }
  )
)
