import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { LogEntry, ScanResult } from '@/types'

interface ScanState {
  // 数据状态
  isScanning: boolean
  logs: LogEntry[]
  result: ScanResult | null
  error: string | null

  // 动作
  setIsScanning: (isScanning: boolean) => void
  addLog: (log: LogEntry) => void
  setResult: (result: ScanResult | null) => void
  setError: (error: string | null) => void
  clearLogs: () => void
}

// 配置常量
const MAX_LOGS = 500

export const useScanStore = create<ScanState>()(
  persist(
    (set) => ({
      isScanning: false,
      logs: [],
      result: null,
      error: null,

      setIsScanning: (isScanning) => set({ isScanning }),

      addLog: (log) =>
        set((state) => {
          // 添加新日志，并截取最后 N 条
          const newLogs = [...state.logs, log]
          return {
            logs: newLogs.length > MAX_LOGS ? newLogs.slice(newLogs.length - MAX_LOGS) : newLogs
          }
        }),

      setResult: (result) => set({ result }),

      setError: (error) => set({ error }),

      clearLogs: () => set({ logs: [], result: null, error: null, isScanning: false })
    }),
    {
      name: 'pixishelf-scan-logs', // localStorage key
      storage: createJSONStorage(() => localStorage),
      // 只持久化日志和结果，扫描状态建议不持久化(避免刷新页面卡死在loading)
      partialize: (state) => ({
        logs: state.logs,
        result: state.result
      })
    }
  )
)
