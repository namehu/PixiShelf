import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import localforage from 'localforage'
import { UserStats, UserProgressStorage, UserProgress, PixivUserData } from '../../../types/pixiv'
import { createComputed } from './zustandComputed'

interface DownloadProgress {
  current: number
  total: number
  isDownloading: boolean
}

interface ComputedValues {
  successfulUsers: Array<{ userId: string; data: PixivUserData }>
  failedUsers: Array<{ userId: string; error: string }>
  usersWithImages: Array<{ userId: string; data: PixivUserData }>
}

type UserInfoBaseState = Omit<UserInfoState, keyof ComputedValues>

interface UserInfoState extends ComputedValues {
  // 原始数据（持久化）
  userIdList: string[]
  progressData: UserProgressStorage
  userStats: UserStats // 改为普通属性，支持持久化

  // 运行时状态（不持久化）
  isRunning: boolean
  isPaused: boolean
  downloadProgress: DownloadProgress
  logs: string[]

  // 数据操作方法
  setUserIdList: (userIds: string[]) => void
  addUserIds: (userIdInput: string) => { added: number; total: number; duplicates: number }
  addUserIdsArray: (userIds: string[]) => void
  removeUserId: (userId: string) => void
  updateProgress: (userId: string, progress: UserProgress) => void
  // clearProgress: () => void
  clearAll: () => void
  updateUserStats: () => void

  // 运行时状态操作方法
  setTaskStatus: (status: { isRunning?: boolean; isPaused?: boolean }) => void
  setDownloadProgress: (progress: Partial<DownloadProgress>) => void
  addLog: (message: string) => void
  clearLogs: () => void

  // 重置状态
  resetTaskState: () => void

  // 数据查询方法
  getStats: () => UserStats
  getProgress: () => UserProgressStorage
  getUserIdList: () => string[]
}

const initialDownloadProgress: DownloadProgress = {
  current: 0,
  total: 0,
  isDownloading: false
}

const initialUserStats: UserStats = {
  total: 0,
  completed: 0,
  successful: 0,
  failed: 0,
  pending: 0
}

// 创建 localforage 实例
const userStorage = localforage.createInstance({
  name: 'pixiv-extension',
  storeName: 'user-info-store'
})

// 计算用户统计信息的辅助函数
const calculateUserStats = (userIdList: string[], progressData: UserProgressStorage): UserStats => {
  const total = userIdList.length
  const completed = Object.keys(progressData).length
  const successful = Object.values(progressData).filter((p) => p.status === 'fulfilled').length
  const failed = Object.values(progressData).filter((p) => p.status === 'rejected').length
  const pending = total - completed

  return { total, completed, successful, failed, pending }
}

export const useUserInfoStore = create<UserInfoBaseState>()(
  persist(
    createComputed<UserInfoBaseState, ComputedValues>(
      (state) => {
        const successfulUsers: Array<{ userId: string; data: PixivUserData }> = []
        const failedUsers: Array<{ userId: string; error: string }> = []
        const usersWithImages: Array<{ userId: string; data: PixivUserData }> = []

        Object.entries(state.progressData).forEach(([userId, progress]) => {
          if (progress.status === 'fulfilled') {
            const data = progress.data as PixivUserData
            successfulUsers.push({ userId, data })

            if (data.avatarUrl || data.backgroundUrl) {
              usersWithImages.push({ userId, data })
            }
          } else if (progress.status === 'rejected') {
            failedUsers.push({
              userId,
              error: typeof progress.data === 'string' ? progress.data : '未知错误'
            })
          }
        })

        return {
          successfulUsers,
          failedUsers,
          usersWithImages
        }
      },
      { keys: ['progressData'] }
    )((set, get) => {
      return {
        // 初始状态
        userIdList: [],
        progressData: {},
        userStats: initialUserStats,
        isRunning: false,
        isPaused: false,
        downloadProgress: initialDownloadProgress,
        logs: [],

        // 数据操作方法
        setUserIdList: (userIds) => {
          set((state) => {
            const newStats = calculateUserStats(userIds, state.progressData)
            return { userIdList: userIds, userStats: newStats }
          })
        },

        addUserIds: (userIdInput) => {
          const existingUserIds = get().userIdList
          const userIds = [
            ...new Set(
              userIdInput
                .split('\n')
                .map((tag) => tag.trim())
                .filter(Boolean)
            )
          ]

          if (userIds.length === 0) {
            return { added: 0, total: existingUserIds.length, duplicates: 0 }
          }

          // 去重
          const existingSet = new Set(existingUserIds)
          const newUserIds = userIds.filter((id) => !existingSet.has(id))

          // 计算统计信息
          const added = newUserIds.length
          const duplicates = userIds.length - added

          // 更新状态
          if (newUserIds.length > 0) {
            set((state) => {
              const currentUserIds = new Set(state.userIdList)
              newUserIds.forEach((id) => currentUserIds.add(id))
              const newUserIdList = Array.from(currentUserIds)
              const newStats = calculateUserStats(newUserIdList, state.progressData)
              return { userIdList: newUserIdList, userStats: newStats }
            })
          }

          const total = existingUserIds.length + added
          return { added, total, duplicates }
        },

        addUserIdsArray: (userIds) => {
          set((state) => {
            const currentUserIds = new Set(state.userIdList)
            userIds.forEach((id) => currentUserIds.add(id))
            const newUserIdList = Array.from(currentUserIds)
            const newStats = calculateUserStats(newUserIdList, state.progressData)
            return { userIdList: newUserIdList, userStats: newStats }
          })
        },

        removeUserId: (userId) => {
          set((state) => {
            const newUserIdList = state.userIdList.filter((id) => id !== userId)
            const newProgressData = { ...state.progressData }
            delete newProgressData[userId]
            const newStats = calculateUserStats(newUserIdList, newProgressData)
            return {
              userIdList: newUserIdList,
              progressData: newProgressData,
              userStats: newStats
            }
          })
        },

        updateProgress: (userId, progress) => {
          set((state) => {
            const newProgressData = {
              ...state.progressData,
              [userId]: progress
            }
            const newStats = calculateUserStats(state.userIdList, newProgressData)
            return {
              progressData: newProgressData,
              userStats: newStats
            }
          })
        },

        clearAll: () => {
          set({
            userIdList: [],
            progressData: {},
            userStats: initialUserStats,
            logs: []
          })
        },

        updateUserStats: () => {
          set((state) => ({
            userStats: calculateUserStats(state.userIdList, state.progressData)
          }))
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

        resetTaskState: () => {
          set({
            isRunning: false,
            isPaused: false,
            downloadProgress: initialDownloadProgress,
            logs: []
          })
        },

        // 数据查询方法
        getStats: () => {
          return get().userStats
        },

        getProgress: () => {
          return get().progressData
        },

        getUserIdList: () => {
          return get().userIdList
        }
      }
    }),
    {
      name: 'pixiv-user-info-store',
      storage: userStorage,
      // 持久化核心数据，包括 userStats
      partialize: (state) => ({
        userIdList: state.userIdList,
        progressData: state.progressData,
        userStats: state.userStats,
        logs: state.logs.slice(-500) // 只保存最近500条日志
      }),
      // 数据加载完成后重新计算统计信息
      onRehydrateStorage: () => (state) => {
        if (state) {
          // 确保数据加载完成后统计信息是最新的
          state.updateUserStats()
        }
      }
    }
  )
)
