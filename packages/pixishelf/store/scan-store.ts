import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { ScanResult } from '@/types'

interface ScanState {
  // 数据状态
  isScanning: boolean
  result: ScanResult | null
  error: string | null

  // 动作
  setIsScanning: (isScanning: boolean) => void
  setResult: (result: ScanResult | null) => void
  setError: (error: string | null) => void
  clearLogs: () => void
}

export const useScanStore = create<ScanState>()(
  persist(
    (set) => ({
      isScanning: false,
      result: null,
      error: null,

      setIsScanning: (isScanning) => set({ isScanning }),

      setResult: (result) => set({ result }),

      setError: (error) => set({ error }),

      // 清除状态 (保留方法名以兼容，但仅清除结果和错误)
      clearLogs: () => set({ result: null, error: null, isScanning: false })
    }),
    {
      name: 'pixishelf-scan-logs', // localStorage key
      storage: createJSONStorage(() => localStorage),
      // 只持久化结果
      partialize: (state) => ({
        result: state.result
      })
    }
  )
)
