import { useCallback } from 'react'
import { useLogStore, LogModule } from '../stores/logStore'

/**
 * 自定义日志钩子，用于在指定模块下记录日志
 * @param module 日志模块名称，用于区分不同组件或功能的日志
 * @returns 包含日志记录方法和日志列表的对象
 */
export const useLogger = (module: LogModule) => {
  const addLog = useLogStore((state) => state.addLog)
  const clearLogsAction = useLogStore((state) => state.clearLogs)
  const storeLogs = useLogStore((state) => state.logs)

  const logs = useMemo(() => storeLogs.filter((l) => l.module === module), [storeLogs, module])

  const log = useCallback(
    (message: string) => {
      addLog(module, message, 'info')
    },
    [addLog, module]
  )

  const success = useCallback(
    (message: string) => {
      addLog(module, message, 'success')
    },
    [addLog, module]
  )

  const warn = useCallback(
    (message: string) => {
      addLog(module, message, 'warn')
    },
    [addLog, module]
  )

  const error = useCallback(
    (message: string) => {
      addLog(module, message, 'error')
    },
    [addLog, module]
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
