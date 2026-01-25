import { useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, LogModule, LogLevel } from '../lib/db'

/**
 * 自定义日志钩子，用于在指定模块下记录日志
 * @param module 日志模块名称
 * @param limit 获取日志的最大条数，默认为 2000
 */
export const useLogger = (module: LogModule, limit = 2000) => {
  const logs =
    useLiveQuery(async () => {
      // 获取最新的 N 条日志 (ID 倒序)
      const result = await db.logs
        .where('module')
        .equals(module)
        .reverse()
        .limit(limit)
        .toArray()
      
      // 反转回正序 (旧 -> 新)，以便在 UI 中按时间顺序显示
      return result.reverse()
    }, [module, limit]) || []

  const addLog = useCallback(
    async (message: string, level: LogLevel, data?: any) => {
      try {
        await db.logs.add({
          module,
          level,
          message,
          timestamp: Date.now(),
          data
        })
      } catch (e) {
        console.error('Failed to add log', e)
      }
    },
    [module]
  )

  const clearLogs = useCallback(async () => {
    try {
      await db.logs.where('module').equals(module).delete()
    } catch (e) {
      console.error('Failed to clear logs', e)
    }
  }, [module])

  // 快捷方法
  const info = useCallback((msg: string, data?: any) => addLog(msg, 'info', data), [addLog])
  const warn = useCallback((msg: string, data?: any) => addLog(msg, 'warn', data), [addLog])
  const error = useCallback((msg: string, data?: any) => addLog(msg, 'error', data), [addLog])
  const success = useCallback((msg: string, data?: any) => addLog(msg, 'success', data), [addLog])

  return {
    logs,
    addLog,
    clearLogs,
    info,
    warn,
    error,
    success
  }
}
