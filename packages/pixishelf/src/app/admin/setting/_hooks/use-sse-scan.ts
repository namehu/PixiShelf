import React from 'react'
import { toast } from 'sonner'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { ScanResult, ScanProgress, LogEntry } from '@/types'
import { useScanStore } from '@/store/scanStore'

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
  logs: LogEntry[]
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
  setAutoScroll: (auto: boolean) => void
  setShowDetailedLogs: (show: boolean) => void
  showDetailedLogs: boolean
  autoScroll: boolean
}

/**
 * Unified SSE Scan Hook using fetch-event-source
 */
export function useSseScan(): { state: SseScanState; actions: SseScanActions } {
  // 1. Global Store State
  const {
    isScanning,
    logs,
    result,
    error,
    setIsScanning,
    addLog,
    setResult,
    setError,
    clearLogs: storeClearLogs
  } = useScanStore()

  // 2. Local State
  const [progress, setProgress] = React.useState<ScanProgress | null>(null)
  const [elapsed, setElapsed] = React.useState(0)
  const [retryCount, setRetryCount] = React.useState(0)
  const [showDetailedLogs, setShowDetailedLogs] = React.useState(false)
  const [autoScroll, setAutoScroll] = React.useState(true)

  // 3. Refs
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

  const addLogEntry = React.useCallback(
    (type: LogEntry['type'], data: any, message: string) => {
      const entry: LogEntry = {
        timestamp: new Date().toLocaleTimeString(),
        type,
        data,
        message
      }
      addLog(entry)
    },
    [addLog]
  )

  const handleSseEvent = React.useCallback(
    (eventName: string, data: any) => {
      switch (eventName) {
        case 'connection':
          addLogEntry('connection', data, data?.result || '连接已建立')
          break

        case 'progress':
          const progressData = data as ScanProgress
          setProgress(progressData)
          addLogEntry('progress', progressData, `进度: ${progressData.message} (${progressData.percentage || 0}%)`)
          break

        case 'complete':
          const completeData = data as { success: boolean; result: ScanResult }
          setIsScanning(false)
          setResult(completeData.result)
          setError(null)
          addLogEntry(
            'complete',
            completeData,
            `完成: 新增${completeData.result.newArtworks}个作品，${completeData.result.newImages}张图片`
          )
          toast.success('扫描完成')
          break

        case 'error':
          const errorData = data as { success: boolean; error: string }
          const errorMsg = errorData?.error || '未知错误'
          setIsScanning(false)
          setError(errorMsg)
          setResult(null)
          addLogEntry('error', errorData, `错误: ${errorMsg}`)
          break

        case 'cancelled':
          setIsScanning(false)
          setError('扫描已取消')
          setResult(null)
          addLogEntry('cancelled', data, '扫描已取消')
          break
      }

      // Stop stream on terminal events
      if (['complete', 'error', 'cancelled'].includes(eventName)) {
        fetchControllerRef.current?.abort()
        fetchControllerRef.current = null
      }
    },
    [addLogEntry, setError, setIsScanning, setResult]
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

      addLogEntry('connection', { url, type: body.type, items: options.metadataList?.length }, `开始连接(POST): ${url}`)

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
            if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
              // Connection successful
              retryCountRef.current = 0
              setRetryCount(0)
              return
            }

            // Client errors (4xx) should not be retried
            if (response.status >= 400 && response.status < 500) {
              throw new FatalError(`Client Error: ${response.status} ${response.statusText}`)
            }

            // If we get here, it's an error (e.g. 500)
            const errorText = await response.text()
            // Throwing here triggers onerror
            throw new Error(`Connection failed: ${response.status} ${errorText}`)
          },

          onmessage(msg) {
            if (msg.event === 'ping') return
            try {
              const data = JSON.parse(msg.data)
              handleSseEvent(msg.event, data)
            } catch (e) {
              addLogEntry('error', { error: e, rawData: msg.data }, '解析SSE数据失败')
            }
          },

          onclose() {
            // If the server closes the connection, we consider it done unless we haven't finished.
            // But usually 'complete' event handles the cleanup.
            // If we reach here without 'complete', it might be a premature close.
            // fetch-event-source retries on close by default unless we throw.
            // We'll throw to stop unless we want to retry?
            // If we are not scanning anymore, do nothing.
            if (!streamingRef.current) return

            // If we are still scanning and connection closed, maybe retry?
            // But let's assume server closes only when done or error.
            // We'll throw to stop the library from retrying automatically without our control.
            throw new Error('Connection closed by server')
          },

          onerror(err) {
            // Stop retrying on fatal errors (4xx)
            if (err instanceof FatalError) {
              throw err
            }

            if (controller.signal.aborted) {
              // User aborted, rethrow to stop
              throw err
            }

            // Retry logic
            const currentRetry = retryCountRef.current
            if (currentRetry < 3) {
              const nextRetry = currentRetry + 1
              retryCountRef.current = nextRetry
              setRetryCount(nextRetry)

              const timeout = 2000 * nextRetry
              addLogEntry(
                'connection',
                { retryCount: nextRetry, error: err.message },
                `连接中断，${timeout}ms后第${nextRetry}次重连`
              )

              // return timeout in ms to retry
              return timeout
            }
            // Max retries reached
            addLogEntry('error', { retryCount: currentRetry, error: err.message }, '连接中断，重试次数已达上限')
            setIsScanning(false)
            setError(`连接失败: ${err.message}`)
            throw err // Stop retrying
          }
        })
      } catch (err: any) {
        if (controller.signal.aborted) {
          // Expected abort
          return
        }
        // Other errors not handled by onerror or thrown by onerror
        // If we haven't already set error state:
        if (streamingRef.current) {
          setIsScanning(false)
          setError(err.message || 'Unknown error')
          addLogEntry('error', { error: err }, `扫描失败: ${err.message}`)
        }
      } finally {
        if (fetchControllerRef.current === controller) {
          fetchControllerRef.current = null
        }
      }
    },
    [addLogEntry, handleSseEvent, setIsScanning, setError]
  )

  // --- Actions ---

  const startScan = React.useCallback(
    (options: ScanOptions) => {
      // Reset state
      fetchControllerRef.current?.abort()
      storeClearLogs()
      setIsScanning(true)
      setResult(null)
      setError(null)
      setProgress(null)
      setRetryCount(0)
      retryCountRef.current = 0
      setShowDetailedLogs(false)

      streamingRef.current = true

      runScan(options)
    },
    [storeClearLogs, setIsScanning, setResult, setError, runScan]
  )

  const cancelScan = React.useCallback(() => {
    fetchControllerRef.current?.abort()
    fetchControllerRef.current = null

    if (streamingRef.current) {
      handleSseEvent('cancelled', { client: true, message: 'User cancelled' })
    }
  }, [handleSseEvent])

  return {
    state: {
      streaming: isScanning,
      logs,
      streamResult: result,
      streamError: error,
      progress,
      elapsed,
      retryCount
    },
    actions: {
      startScan,
      cancelScan,
      clearLogs: storeClearLogs,
      autoScroll,
      setAutoScroll,
      showDetailedLogs,
      setShowDetailedLogs
    }
  }
}
