import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import localforage from 'localforage'
import { TaskStats } from '../../types/pixiv'

interface DownloadProgress {
  current: number
  total: number
  isDownloading: boolean
}

interface TaskState {
  // 任务统计
  taskStats: TaskStats

  // 任务状态
  isRunning: boolean
  isPaused: boolean

  // 下载进度
  downloadProgress: DownloadProgress

  // 日志
  logs: string[]

  // 标签输入
  tagInput: string

  // 操作方法
  setTaskStats: (stats: TaskStats) => void
  setTaskStatus: (status: { isRunning?: boolean; isPaused?: boolean }) => void
  setDownloadProgress: (progress: Partial<DownloadProgress>) => void
  addLog: (message: string) => void
  clearLogs: () => void
  setTagInput: (input: string) => void

  // 重置状态
  resetTaskState: () => void
}

const initialTaskStats: TaskStats = {
  total: 0,
  completed: 0,
  successful: 0,
  failed: 0,
  pending: 0
}

const initialDownloadProgress: DownloadProgress = {
  current: 0,
  total: 0,
  isDownloading: false
}

// 配置 localforage 实例
const taskStorage = localforage.createInstance({
  name: 'pixiv-extension',
  storeName: 'task-store'
})

export const useTaskStore = create<TaskState>()(
  persist(
    (set) => ({
      taskStats: initialTaskStats,
      isRunning: false,
      isPaused: false,
      downloadProgress: initialDownloadProgress,
      logs: [],
      tagInput: '',

      setTaskStats: (stats) => {
        set({ taskStats: stats })
      },

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
          logs: [...state.logs, logMessage].slice(-100) // 保持最新100条日志
        }))
      },

      clearLogs: () => {
        set({ logs: [] })
      },

      setTagInput: (input) => {
        set({ tagInput: input })
      },

      resetTaskState: () => {
        set({
          taskStats: initialTaskStats,
          isRunning: false,
          isPaused: false,
          downloadProgress: initialDownloadProgress,
          tagInput: ''
        })
      }
    }),
    {
      name: 'pixiv-task-store',
      storage: taskStorage,
      // 只持久化需要的状态，排除方法和临时状态
      partialize: (state) => ({
        taskStats: state.taskStats,
        tagInput: state.tagInput,
        logs: state.logs.slice(-500) // 只保存最近50条日志
      })
    }
  )
)
