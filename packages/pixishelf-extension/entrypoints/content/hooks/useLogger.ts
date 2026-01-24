// oxlint-disable no-console
import { useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, LogModule, LogLevel } from '../services/db'

/**
 * 自定义日志钩子，用于在指定模块下记录日志
 * @param module 日志模块名称，用于区分不同组件或功能的日志
 * @returns 包含日志记录方法和日志列表的对象
 */
export const useLogger = (module: LogModule) => {
  const logs =
    useLiveQuery(() => db.logs.where('module').equals(module).reverse().limit(2000).toArray(), [module]) || []

  const addLog = useCallback(
    async (message: string, level: LogLevel) => {
      try {
        await db.logs.add({
          module,
          level,
          message,
          timestamp: Date.now()
        })
      } catch (e) {
        console.error('Failed to add log', e)
      }
    },
    [module]
  )

  const clearLogsAction = useCallback(async (mod?: LogModule) => {
    try {
      if (mod) {
        await db.logs.where('module').equals(mod).delete()
      } else {
        await db.logs.clear()
      }
    } catch (e) {
      console.error('Failed to clear logs', e)
    }
  }, [])

  const log = useCallback(
    (message: string) => {
      addLog(message, 'info')
    },
    [addLog]
  )

  const success = useCallback(
    (message: string) => {
      addLog(message, 'success')
    },
    [addLog]
  )

  const warn = useCallback(
    (message: string) => {
      addLog(message, 'warn')
    },
    [addLog]
  )

  const error = useCallback(
    (message: string) => {
      addLog(message, 'error')
    },
    [addLog]
  )

  const clear = useCallback(() => {
    clearLogsAction(module)
  }, [clearLogsAction, module])

  return {
    logs,
    log,
    success,
    warn,
    error,
    clear
  }
}
