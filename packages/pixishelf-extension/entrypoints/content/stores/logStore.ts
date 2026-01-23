import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import localforage from 'localforage'
import { v4 as uuidv4 } from 'uuid'

export type LogLevel = 'info' | 'success' | 'warn' | 'error'
export type LogModule = 'artwork' | 'artist' | 'tag' | 'system'

export interface LogEntry {
  id: string
  timestamp: number
  module: LogModule
  level: LogLevel
  message: string
}

interface LogStoreState {
  logs: LogEntry[]

  // Actions
  addLog: (module: LogModule, message: string, level?: LogLevel) => void
  clearLogs: (module?: LogModule) => void
  getLogsByModule: (module: LogModule) => LogEntry[]
}

// Configure localforage
const logStorage = localforage.createInstance({
  name: 'pixiv-extension',
  storeName: 'log-store'
})

export const useLogStore = create<LogStoreState>()(
  persist(
    (set, get) => ({
      logs: [],

      addLog: (module, message, level = 'info') => {
        const entry: LogEntry = {
          id: uuidv4(),
          timestamp: Date.now(),
          module,
          level,
          message
        }

        set((state) => ({
          // Keep last 1000 logs globally
          logs: [...state.logs, entry].slice(-1000)
        }))
      },

      clearLogs: (module) => {
        if (module) {
          // Clear only specific module logs
          set((state) => ({
            logs: state.logs.filter((log) => log.module !== module)
          }))
        } else {
          // Clear all
          set({ logs: [] })
        }
      },

      getLogsByModule: (module) => {
        return get().logs.filter((log) => log.module === module)
      }
    }),
    {
      name: 'pixiv-log-store',
      storage: logStorage,
      partialize: (state) => ({
        logs: state.logs.slice(-1000) // Persist only last 1000
      })
    }
  )
)
