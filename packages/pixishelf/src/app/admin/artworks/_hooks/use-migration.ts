import React from 'react'
import { toast } from 'sonner'
import { useTRPCClient } from '@/lib/trpc'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { useLogger } from '@/hooks/use-logger'
import { create } from 'zustand'

/**
 * Migration specific types
 */
export interface MigrationStats {
  total: number
  processed: number
  success: number
  skipped: number
  failed: number
  failedItems?: MigrationFailedItem[]
}

export interface MigrationOptions {
  targetIds?: number[]
  filters?: MigrationFilters
  safety?: MigrationSafetyOptions
  onComplete?: () => void
}

export interface MigrationFilters {
  search?: string | null
  artistName?: string | null
  startDate?: string | null
  endDate?: string | null
  externalId?: string | null
  exactMatch?: boolean
}

export interface MigrationFailedItem {
  artworkId: number
  externalId: string | null
  msg: string[]
}

export interface MigrationSafetyOptions {
  transferMode?: 'move' | 'copy'
  verifyAfterCopy?: boolean
  cleanupSource?: boolean
}

/**
 * Global Migration Store (Simple Zustand)
 * To share state between hook and components if needed
 */
interface MigrationStore {
  isMigrating: boolean
  paused: boolean
  stats: MigrationStats | null
  error: string | null
  setIsMigrating: (v: boolean) => void
  setPaused: (v: boolean) => void
  setStats: (v: MigrationStats | null) => void
  setError: (v: string | null) => void
  reset: () => void
}

export const useMigrationStore = create<MigrationStore>((set) => ({
  isMigrating: false,
  paused: false,
  stats: null,
  error: null,
  setIsMigrating: (v) => set({ isMigrating: v }),
  setPaused: (v) => set({ paused: v }),
  setStats: (v) => set({ stats: v }),
  setError: (v) => set({ error: v }),
  reset: () => set({ isMigrating: false, paused: false, stats: null, error: null })
}))

/**
 * Fatal Error that should not be retried
 */
class FatalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FatalError'
  }
}

/**
 * Hook state
 */
interface SseMigrationState {
  migrating: boolean
  paused: boolean
  stats: MigrationStats | null
  error: string | null
  currentMessage: string
  elapsed: number
}

/**
 * Hook actions
 */
interface SseMigrationActions {
  startMigration: (options?: MigrationOptions) => void
  cancelMigration: () => void
  pauseMigration: () => void
  resumeMigration: () => void
  exportFailed: () => void
  retryFailed: () => void
  clearLogs: () => void
}

/**
 * SSE Migration Hook
 */
export function useMigration(): {
  state: SseMigrationState
  actions: SseMigrationActions
  logger: ReturnType<typeof useLogger>
} {
  // 1. Global Store State
  const { isMigrating, paused, stats, error, setIsMigrating, setPaused, setStats, setError, reset } =
    useMigrationStore()
  const trpcClient = useTRPCClient()

  // 2. Logger Hook - use independent logger namespace
  const logger = useLogger('migration-client')

  // 3. Local State
  const [currentMessage, setCurrentMessage] = React.useState('')
  const [elapsed, setElapsed] = React.useState(0)

  // 4. Refs
  const fetchControllerRef = React.useRef<AbortController | null>(null)
  const streamingRef = React.useRef(false)
  const onCompleteRef = React.useRef<(() => void) | undefined>(undefined)

  // Sync streaming ref
  React.useEffect(() => {
    streamingRef.current = isMigrating
  }, [isMigrating])

  // Timer
  React.useEffect(() => {
    let timer: NodeJS.Timeout
    if (isMigrating) {
      const started = Date.now()
      setElapsed(0)
      timer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - started) / 1000))
      }, 1000)
    }
    return () => clearInterval(timer)
  }, [isMigrating])

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      fetchControllerRef.current?.abort()
    }
  }, [])

  // --- Helpers ---

  const handleSseEvent = React.useCallback(
    (eventName: string, data: any) => {
      switch (eventName) {
        case 'connection':
          logger.addLog(data?.result || '连接已建立', 'connection', data)
          break

        case 'progress':
          // data structure: { progress: number, message: string[], stats: MigrationStats }
          const { message, stats: newStats, progress } = data
          const msgs = Array.isArray(message) ? message : [message]

          setCurrentMessage(msgs[msgs.length - 1] || '')
          setStats(newStats)

          msgs.forEach((msg: string) => {
            logger.addLog(`[${progress}%] ${msg}`, 'progress', data)
          })
          break

        case 'complete':
          const completeData = data as { success: boolean; result: MigrationStats }
          setIsMigrating(false)
          setPaused(false)
          setStats(completeData.result)
          setError(null)
          logger.addLog(
            `迁移完成: 成功 ${completeData.result.success}, 失败 ${completeData.result.failed}, 跳过 ${completeData.result.skipped}`,
            'complete',
            completeData
          )
          toast.success('迁移任务完成')
          if (onCompleteRef.current) {
            onCompleteRef.current()
          }
          break

        case 'error':
          const errorData = data as { success: boolean; error: string }
          const errorMsg = errorData?.error || '未知错误'
          setIsMigrating(false)
          setPaused(false)
          setError(errorMsg)
          logger.error(`错误: ${errorMsg}`, errorData)
          break

        case 'cancelled':
          setIsMigrating(false)
          setPaused(false)
          setError('迁移已取消')
          logger.addLog('迁移已取消', 'cancelled', data)
          break

        case 'paused':
          setPaused(true)
          logger.addLog('迁移已暂停', 'paused', data)
          break

        case 'resumed':
          setPaused(false)
          logger.addLog('迁移已恢复', 'resumed', data)
          break
      }

      // Stop stream on terminal events
      if (['complete', 'error', 'cancelled'].includes(eventName)) {
        fetchControllerRef.current?.abort()
        fetchControllerRef.current = null
      }
    },
    [logger, setError, setIsMigrating, setStats]
  )

  // --- Core Logic ---

  const runStream = React.useCallback(
    async (options?: MigrationOptions) => {
      onCompleteRef.current = options?.onComplete
      const url = '/api/migration/stream'
      const body = {
        targetIds: options?.targetIds,
        search: options?.filters?.search ?? null,
        artistName: options?.filters?.artistName ?? null,
        startDate: options?.filters?.startDate ?? null,
        endDate: options?.filters?.endDate ?? null,
        externalId: options?.filters?.externalId ?? null,
        exactMatch: options?.filters?.exactMatch ?? false,
        transferMode: options?.safety?.transferMode ?? 'move',
        verifyAfterCopy: options?.safety?.verifyAfterCopy ?? true,
        cleanupSource: options?.safety?.cleanupSource ?? true
      }

      logger.addLog(`准备开始迁移...`, 'connection', {
        url,
        targets: options?.targetIds?.length || 'ALL'
      })

      const controller = new AbortController()
      fetchControllerRef.current = controller

      try {
        await fetchEventSource(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal,

          async onopen(response) {
            if (response.ok) {
              setIsMigrating(true)
              setPaused(false)
              setError(null)
              return
            } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
              const errorText = await response.text()
              throw new FatalError(errorText)
            }
          },

          onmessage(msg) {
            if (msg.event === 'ping') return
            try {
              const data = JSON.parse(msg.data)
              handleSseEvent(msg.event || 'message', data)
            } catch (err) {
              logger.error('Failed to parse SSE message', err)
            }
          },

          onclose() {
            // Normal closure handled by event logic
          },

          onerror(err) {
            if (err instanceof FatalError) {
              logger.error(`Fatal Error: ${err.message}`)
              throw err
            }
            logger.warn(`Connection error: ${err.message}. Retrying...`)
          }
        })
      } catch (err: any) {
        if (err.name === 'AbortError') return

        setIsMigrating(false)
        setError(err.message)
        logger.error(`连接失败: ${err.message}`)
      }
    },
    [handleSseEvent, setIsMigrating, setError, logger]
  )

  const startMigration = React.useCallback(
    (options?: MigrationOptions) => {
      if (isMigrating) return
      reset()
      logger.clearLogs()
      runStream(options)
    },
    [isMigrating, reset, logger, runStream]
  )

  const controlMigration = React.useCallback(
    async (action: 'pause' | 'resume' | 'cancel') => {
      try {
        await trpcClient.migration.control.mutate({ action })
      } catch (err: any) {
        toast.error(err?.message || '操作失败')
      }
    },
    [trpcClient]
  )

  const cancelMigration = React.useCallback(() => controlMigration('cancel'), [controlMigration])
  const pauseMigration = React.useCallback(() => controlMigration('pause'), [controlMigration])
  const resumeMigration = React.useCallback(() => controlMigration('resume'), [controlMigration])

  const exportFailed = React.useCallback(async () => {
    try {
      const data = await trpcClient.migration.failed.query({})
      const items = (data.items || []) as MigrationFailedItem[]
      if (items.length === 0) {
        toast.info('没有可导出的失败记录')
        return
      }
      const content = items
        .map((item) => `ID: ${item.artworkId}\nExternalId: ${item.externalId ?? ''}\n原因: ${item.msg.join('; ')}\n---`)
        .join('\n')
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `migration-failed-${new Date().toISOString().split('T')[0]}.txt`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      toast.error(err?.message || '导出失败清单失败')
    }
  }, [trpcClient])

  const retryFailed = React.useCallback(async () => {
    if (isMigrating) return
    try {
      const data = await trpcClient.migration.failed.query({})
      const items = (data.items || []) as MigrationFailedItem[]
      if (items.length === 0) {
        toast.info('没有可重试的失败记录')
        return
      }
      const targetIds = items.map((item) => item.artworkId)
      startMigration({ targetIds })
    } catch (err: any) {
      toast.error(err?.message || '失败重试启动失败')
    }
  }, [isMigrating, startMigration, trpcClient])

  const clearLogs = React.useCallback(() => {
    logger.clearLogs()
    reset()
  }, [logger, reset])

  return {
    state: {
      migrating: isMigrating,
      paused,
      stats,
      error,
      currentMessage,
      elapsed
    },
    actions: {
      startMigration,
      cancelMigration,
      pauseMigration,
      resumeMigration,
      exportFailed,
      retryFailed,
      clearLogs
    },
    logger
  }
}
