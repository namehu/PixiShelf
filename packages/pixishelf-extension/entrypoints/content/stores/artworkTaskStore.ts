import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import localforage from 'localforage'
import { ArtworkStats, PixivArtworkData } from '../../../types/pixiv'
import { createComputed } from './zustandComputed'

export interface ArtworkItem {
  id: string
  status: 'pending' | 'running' | 'fulfilled' | 'rejected'
  data?: PixivArtworkData
  error?: string
}

interface ComputedValues {
  taskStats: ArtworkStats
  successfulItems: ArtworkItem[]
}

type ArtworkTaskBaseState = Omit<ArtworkTaskState, keyof ComputedValues>

interface ArtworkTaskState extends ComputedValues {
  // 核心数据
  queue: ArtworkItem[]

  // 运行时状态
  isRunning: boolean
  isPaused: boolean
  artworkInput: string

  // Actions
  addIds: (ids: string[]) => { added: number; total: number; duplicates: number }
  updateItem: (id: string, updates: Partial<Omit<ArtworkItem, 'id'>>) => void
  removeItem: (id: string) => void
  clearAll: () => void

  // 运行时 Actions
  setTaskStatus: (status: { isRunning?: boolean; isPaused?: boolean }) => void
  setArtworkInput: (input: string) => void
  resetTaskState: () => void
}

// 配置 localforage 实例
const artworkStorage = localforage.createInstance({
  name: 'pixiv-extension',
  storeName: 'artwork-task-store'
})

export const useArtworkTaskStore = create<ArtworkTaskBaseState>()(
  createComputed<ArtworkTaskBaseState, ComputedValues>(
    (state) => {
      const queue = state.queue
      const total = queue.length
      const pending = queue.filter((i) => i.status === 'pending').length
      const running = queue.filter((i) => i.status === 'running').length
      const successful = queue.filter((i) => i.status === 'fulfilled').length
      const failed = queue.filter((i) => i.status === 'rejected').length

      // Completed = successful + failed (running is not completed, pending is not completed)
      const completed = successful + failed

      return {
        taskStats: {
          total,
          completed,
          successful,
          failed,
          pending: pending + running // running is also technically pending completion
        },
        successfulItems: queue.filter((i) => i.status === 'fulfilled')
      }
    },
    { keys: ['queue'] }
  )(
    persist(
      (set, get) => ({
        // 核心数据
        queue: [],

        // 运行时状态
        isRunning: false,
        isPaused: false,
        artworkInput: '',

        // Actions
        addIds: (ids) => {
          if (ids.length === 0) {
            return { added: 0, total: get().queue.length, duplicates: 0 }
          }

          const currentQueue = get().queue
          const existingIds = new Set(currentQueue.map((i) => i.id))
          const newIds = ids.filter((id) => !existingIds.has(id))

          const added = newIds.length
          const duplicates = ids.length - added

          if (newIds.length > 0) {
            const newItems: ArtworkItem[] = newIds.map((id) => ({
              id,
              status: 'pending'
            }))

            set((state) => ({
              queue: [...state.queue, ...newItems]
            }))
          }

          return { added, total: get().queue.length, duplicates }
        },

        updateItem: (id, updates) => {
          set((state) => ({
            queue: state.queue.map((item) => (item.id === id ? { ...item, ...updates } : item))
          }))
        },

        removeItem: (id) => {
          set((state) => ({
            queue: state.queue.filter((item) => item.id !== id)
          }))
        },

        clearAll: () => {
          set({
            queue: [],
            artworkInput: '',
            isRunning: false,
            isPaused: false
          })
        },

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
      }),
      {
        name: 'pixiv-artwork-task-store',
        storage: artworkStorage,
        partialize: (state) => ({
          queue: state.queue,
          artworkInput: state.artworkInput
        })
      }
    )
  )
)
