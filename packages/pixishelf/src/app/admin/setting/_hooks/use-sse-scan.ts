import React from 'react'
import { toast } from 'sonner'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { ScanResult, ScanProgress } from '@/types'
import { useScanStore } from '@/store/scanStore'
import { useLogger } from '@/hooks/use-logger'

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
 * Scan options for starting a scan
 */
interface ScanOptions {
  /** Force full scan (re-scan existing files) */
  force?: boolean
  /** List of metadata paths for partial scan */
  metadataList?: string[]
}

/**
 * Hook state
 */
interface SseScanState {
  streaming: boolean
  progress: ScanProgress | null
  streamResult: ScanResult | null
  streamError: string | null
  elapsed: number
  retryCount: number
}

/**
 * Hook actions
 */
interface SseScanActions {
  startScan: (options: ScanOptions) => void
  cancelScan: () => void
  clearLogs: () => void
}

/**
 * Unified SSE Scan Hook using fetch-event-source
 */
export function useSseScan(): { state: SseScanState; actions: SseScanActions } {
  // 1. Global Store State
  const {
    isScanning,
    result,
    error,
    setIsScanning,
    setResult,
    setError,
    clearLogs: storeClearLogs // 我们仍需清除 store 中的状态，但日志由 useLogger 管理
  } = useScanStore()

  // 2. Logger Hook
  const logger = useLogger('scan-server')

  // 3. Local State
  const [progress, setProgress] = React.useState<ScanProgress | null>(null)
  const [elapsed, setElapsed] = React.useState(0)
  const [retryCount, setRetryCount] = React.useState(0)

  // 4. Refs
  const fetchControllerRef = React.useRef<AbortController | null>(null)
  const streamingRef = React.useRef(false)
  const retryCountRef = React.useRef(0) // Use ref for retry logic inside callbacks

  // Sync streaming ref
  React.useEffect(() => {
    streamingRef.current = isScanning
  }, [isScanning])

  // Timer
  React.useEffect(() => {
    let timer: NodeJS.Timeout
    if (isScanning) {
      const started = Date.now()
      setElapsed(0)
      timer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - started) / 1000))
      }, 1000)
    }
    return () => clearInterval(timer)
  }, [isScanning])

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
          const progressData = data as ScanProgress
          setProgress(progressData)
          logger.addLog(`进度: ${progressData.message} (${progressData.percentage || 0}%)`, 'progress', progressData)
          break

        case 'complete':
          const completeData = data as { success: boolean; result: ScanResult }
          setIsScanning(false)
          setResult(completeData.result)
          setError(null)
          logger.addLog(
            `完成: 新增${completeData.result.newArtworks}个作品，${completeData.result.newImages}张图片`,
            'complete',
            completeData
          )
          toast.success('扫描完成')
          break

        case 'error':
          const errorData = data as { success: boolean; error: string }
          const errorMsg = errorData?.error || '未知错误'
          setIsScanning(false)
          setError(errorMsg)
          setResult(null)
          logger.error(`错误: ${errorMsg}`, errorData)
          break

        case 'cancelled':
          setIsScanning(false)
          setError('扫描已取消')
          setResult(null)
          logger.addLog('扫描已取消', 'cancelled', data)
          break
      }

      // Stop stream on terminal events
      if (['complete', 'error', 'cancelled'].includes(eventName)) {
        fetchControllerRef.current?.abort()
        fetchControllerRef.current = null
      }
    },
    [logger, setError, setIsScanning, setResult]
  )

  // --- Core Logic ---

  const runScan = React.useCallback(
    async (options: ScanOptions) => {
      const url = '/api/scan/stream'
      const isListScan = options.metadataList && options.metadataList.length > 0
      const body = {
        type: isListScan ? 'list' : 'full',
        force: options.force,
        metadataList: options.metadataList
      }

      logger.addLog(`开始连接(POST): ${url}`, 'connection', {
        url,
        type: body.type,
        items: options.metadataList?.length
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
              setIsScanning(true)
              setError(null)
              setResult(null)
              retryCountRef.current = 0 // Reset retry count on success
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
            if (streamingRef.current) {
              // 如果是意外关闭（streaming 仍为 true），可能需要处理重连或报错
              // 这里简单视为结束
              // setIsScanning(false)
            }
          },

          onerror(err) {
            if (err instanceof FatalError) {
              logger.error(`Fatal Error: ${err.message}`)
              throw err // Stop retrying
            }
            logger.warn(`Connection error: ${err.message}. Retrying...`)
            // Default retry logic applies
          }
        })
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // Normal cancellation
          return
        }
        setIsScanning(false)
        setError(err.message)
        logger.error(`扫描失败: ${err.message}`)
      }
    },
    [handleSseEvent, setIsScanning, setError, setResult, logger]
  )

  const startScan = React.useCallback(
    (options: ScanOptions) => {
      if (isScanning) return
      storeClearLogs() // 清除 UI store 状态
      runScan(options)
    },
    [isScanning, storeClearLogs, runScan]
  )

  const cancelScan = React.useCallback(() => {
    if (fetchControllerRef.current) {
      fetchControllerRef.current.abort()
      fetchControllerRef.current = null
      handleSseEvent('cancelled', {})
    }
  }, [handleSseEvent])

  const clearLogs = React.useCallback(() => {
    logger.clearLogs()
    storeClearLogs()
  }, [logger, storeClearLogs])

  return {
    state: {
      streaming: isScanning,
      progress,
      streamResult: result,
      streamError: error,
      elapsed,
      retryCount
    },
    actions: {
      startScan,
      cancelScan,
      clearLogs
    }
  }
}
