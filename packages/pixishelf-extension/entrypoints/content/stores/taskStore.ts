import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import localforage from 'localforage'
import { TaskStats, ProgressStorage, TaskProgress, PixivTagData } from '../../../types/pixiv'

interface DownloadProgress {
  current: number
  total: number
  isDownloading: boolean
}

interface TaskState {
  // 原始数据（持久化）
  tagList: string[]
  progressData: ProgressStorage
  taskStats: TaskStats // 改为普通属性，支持持久化

  // 运行时状态（不持久化）
  isRunning: boolean
  isPaused: boolean
  downloadProgress: DownloadProgress
  logs: string[]
  tagInput: string

  // 计算属性（getter，不持久化）
  get successfulTags(): Array<{ tagName: string; data: PixivTagData }>
  get failedTags(): Array<{ tagName: string; error: string }>
  get tagsWithImages(): Array<{ tagName: string; data: PixivTagData }>

  // 数据操作方法
  setTagList: (tags: string[]) => void
  addTags: (tagInput: string) => { added: number; total: number; duplicates: number } // 修改签名
  addTagsArray: (tags: string[]) => void // 新增：原来的 addTags 方法重命名
  removeTag: (tag: string) => void
  updateProgress: (tag: string, progress: TaskProgress) => void
  clearProgress: () => void
  clearAll: () => void
  updateTaskStats: () => void // 新增：手动更新统计信息的方法

  // 运行时状态操作方法
  setTaskStatus: (status: { isRunning?: boolean; isPaused?: boolean }) => void
  setDownloadProgress: (progress: Partial<DownloadProgress>) => void
  addLog: (message: string) => void
  clearLogs: () => void
  setTagInput: (input: string) => void

  // 重置状态
  resetTaskState: () => void

  // 数据查询方法
  getProgress: () => ProgressStorage
  getTagList: () => string[]
}

const initialDownloadProgress: DownloadProgress = {
  current: 0,
  total: 0,
  isDownloading: false
}

const initialTaskStats: TaskStats = {
  total: 0,
  completed: 0,
  successful: 0,
  failed: 0,
  pending: 0
}

// 配置 localforage 实例
const taskStorage = localforage.createInstance({
  name: 'pixiv-extension',
  storeName: 'task-store'
})

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => {
      // 计算统计信息的辅助函数
      const calculateTaskStats = (tagList: string[], progressData: ProgressStorage): TaskStats => {
        const totalTags = new Set(tagList).size
        const completedCount = Object.keys(progressData).length
        const successCount = Object.values(progressData).filter((p) => p.status === 'fulfilled').length
        const errorCount = completedCount - successCount

        return {
          total: totalTags,
          completed: completedCount,
          successful: successCount,
          failed: errorCount,
          pending: totalTags - completedCount
        }
      }

      return {
        // 原始数据
        tagList: [],
        progressData: {},
        taskStats: initialTaskStats,

        // 运行时状态
        isRunning: false,
        isPaused: false,
        downloadProgress: initialDownloadProgress,
        logs: [],
        tagInput: '',

        // 计算属性（保持为 getter，因为不需要持久化）
        get successfulTags(): Array<{ tagName: string; data: PixivTagData }> {
          const state = get()
          return Object.entries(state.progressData)
            .filter(([_, progress]) => progress.status === 'fulfilled')
            .map(([tagName, progress]) => ({
              tagName,
              data: progress.data as PixivTagData
            }))
        },

        get failedTags(): Array<{ tagName: string; error: string }> {
          const state = get()
          return Object.entries(state.progressData)
            .filter(([_, progress]) => progress.status === 'rejected')
            .map(([tagName, progress]) => ({
              tagName,
              error: progress.data as string
            }))
        },

        get tagsWithImages(): Array<{ tagName: string; data: PixivTagData }> {
          const state = get()
          return Object.entries(state.progressData)
            .filter(([_, progress]) => {
              if (progress.status !== 'fulfilled') return false
              const data = progress.data as PixivTagData
              return data.imageUrl && data.imageUrl.trim() !== ''
            })
            .map(([tagName, progress]) => ({
              tagName,
              data: progress.data as PixivTagData
            }))
        },

        // 更新统计信息的方法
        updateTaskStats: () => {
          const state = get()
          const newStats = calculateTaskStats(state.tagList, state.progressData)
          set({ taskStats: newStats })
        },

        // 数据操作方法（自动更新统计信息）
        setTagList: (tags) => {
          set((state) => {
            const newStats = calculateTaskStats(tags, state.progressData)
            return { tagList: tags, taskStats: newStats }
          })
        },

        addTags: (tagInput: string) => {
          // 解析标签输入
          const tags = tagInput
            .split('\n')
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0)

          if (tags.length === 0) {
            return { added: 0, total: get().tagList.length, duplicates: 0 }
          }

          // 获取现有标签并过滤重复
          const existingTags = get().tagList
          const newTags = tags.filter((tag) => !existingTags.includes(tag))
          
          // 计算统计信息
          const added = newTags.length
          const duplicates = tags.length - added
          
          // 更新状态
          if (newTags.length > 0) {
            set((state) => {
              const currentTags = new Set(state.tagList)
              newTags.forEach((tag) => currentTags.add(tag))
              const newTagList = Array.from(currentTags)
              const newStats = calculateTaskStats(newTagList, state.progressData)
              return { tagList: newTagList, taskStats: newStats }
            })
          }

          const total = existingTags.length + added
          return { added, total, duplicates }
        },

        addTagsArray: (tags) => {
          set((state) => {
            const currentTags = new Set(state.tagList)
            tags.forEach((tag) => currentTags.add(tag))
            const newTagList = Array.from(currentTags)
            const newStats = calculateTaskStats(newTagList, state.progressData)
            return { tagList: newTagList, taskStats: newStats }
          })
        },

        removeTag: (tag) => {
          set((state) => {
            const newTagList = state.tagList.filter((t) => t !== tag)
            const newProgressData = { ...state.progressData }
            delete newProgressData[tag]
            const newStats = calculateTaskStats(newTagList, newProgressData)
            return {
              tagList: newTagList,
              progressData: newProgressData,
              taskStats: newStats
            }
          })
        },

        updateProgress: (tag, progress) => {
          set((state) => {
            const newProgressData = {
              ...state.progressData,
              [tag]: progress
            }
            const newStats = calculateTaskStats(state.tagList, newProgressData)
            return {
              progressData: newProgressData,
              taskStats: newStats
            }
          })
        },

        clearProgress: () => {
          set((state) => {
            const newStats = calculateTaskStats(state.tagList, {})
            return { progressData: {}, taskStats: newStats }
          })
        },

        clearAll: () => {
          set({
            tagList: [],
            progressData: {},
            tagInput: '',
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
            isRunning: false,
            isPaused: false,
            downloadProgress: initialDownloadProgress,
            tagInput: ''
          })
        },

        // 数据查询方法
        getProgress: () => {
          return get().progressData
        },

        getTagList: () => {
          return get().tagList
        }
      }
    },
    {
      name: 'pixiv-task-store',
      storage: taskStorage,
      // 持久化核心数据，包括 taskStats
      partialize: (state) => ({
        tagList: state.tagList,
        progressData: state.progressData,
        taskStats: state.taskStats, // 新增：持久化统计信息
        tagInput: state.tagInput,
        logs: state.logs.slice(-500) // 只保存最近500条日志
      }),
      // 数据加载完成后重新计算统计信息
      onRehydrateStorage: () => (state) => {
        if (state) {
          // 确保数据加载完成后统计信息是最新的
          state.updateTaskStats()
        }
      }
    }
  )
)
