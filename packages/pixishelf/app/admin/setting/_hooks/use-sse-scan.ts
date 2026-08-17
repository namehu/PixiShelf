import React from 'react'
import { toast } from 'sonner'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { ScanResult, ScanProgress } from '@/types'
import { useScanStore } from '@/store/scan-store'
import { useLogger } from '@/hooks/use-logger'
import { formatScanHttpErrorText } from '@/services/scan-service/scan-errors'

/**
 * 不可重试的致命错误（连接层/参数层问题）
 */
class FatalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FatalError'
  }
}

/**
 * 扫描入参配置
 */
interface ScanOptions {
  /** 强制执行完整重扫（重跑现有文件） */
  force?: boolean
  /** 列表扫描时的元数据路径集合 */
  metadataList?: string[]
}

/**
 * 状态结构
 */
interface SseScanState {
  streaming: boolean
  progress: ScanProgress | null
  streamResult: ScanResult | null
  streamError: string | null
  jobId: string | null
  scanRunId: string | null
  elapsed: number
  retryCount: number
}

/**
 * 可调用动作
 */
interface SseScanActions {
  startScan: (options: ScanOptions) => void
  cancelScan: () => void
  clearLogs: () => void
}

/**
 * 扫描 SSE Hook：使用 fetch-event-source 管理长连接与重试
 */
export function useSseScan(): { state: SseScanState; actions: SseScanActions } {
  // 1. 全局状态（与 UI store 同步）
  const {
    isScanning,
    result,
    error,
    setIsScanning,
    setResult,
    setError,
    clearLogs: storeClearLogs // 我们仍需清除 store 中的状态，但日志由 useLogger 管理
  } = useScanStore()

  // 2. 日志 Hook（独立命名空间，避免日志串线）
  const logger = useLogger('scan-server')

  // 3. 本地状态（扫描过程 UI 视图）
  const [progress, setProgress] = React.useState<ScanProgress | null>(null)
  const [jobId, setJobId] = React.useState<string | null>(null)
  const [scanRunId, setScanRunId] = React.useState<string | null>(null)
  const [elapsed, setElapsed] = React.useState(0)
  const [retryCount] = React.useState(0)

  // 4. 运行时引用（如控制器、计时与重试状态）
  const fetchControllerRef = React.useRef<AbortController | null>(null)
  const streamingRef = React.useRef(false)
  const retryCountRef = React.useRef(0) // 用 ref 记录重试次数，避免回调闭包读数过期

  // 同步 streaming 标志，保证事件回调能拿到最新运行态
  React.useEffect(() => {
    streamingRef.current = isScanning
  }, [isScanning])

  // 进度计时器（扫描持续时长）
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

  // 组件卸载时清理连接与定时器
  React.useEffect(() => {
    return () => {
      fetchControllerRef.current?.abort()
    }
  }, [])

  // --- 工具函数 ---

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

        case 'queued':
          const queuedScan = data?.queued as { jobId?: unknown; scanRunId?: unknown } | undefined
          const queuedJobId = typeof queuedScan?.jobId === 'string' ? queuedScan.jobId : null
          const queuedRunId = typeof queuedScan?.scanRunId === 'string' ? queuedScan.scanRunId : null
          setJobId(queuedJobId)
          setScanRunId(queuedRunId)
          setIsScanning(false)
          setError(null)
          setResult(null)
          logger.addLog('扫描任务已加入后台队列', 'connection', queuedScan)
          toast.info('扫描任务已加入后台队列', {
            description: queuedJobId ? `任务 ID: ${queuedJobId}` : undefined
          })
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

      // 到达终态事件时关闭流，防止回调继续触发
      if (['queued', 'complete', 'error', 'cancelled'].includes(eventName)) {
        fetchControllerRef.current?.abort()
        fetchControllerRef.current = null
      }
    },
    [logger, setError, setIsScanning, setResult]
  )

  // --- 核心执行链 ---

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
      setJobId(null)
      setScanRunId(null)

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
              retryCountRef.current = 0 // 成功建立连接后重置重试计数
              return
            } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
              const errorText = await response.text()
              throw new FatalError(formatScanHttpErrorText(errorText))
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
              // 若 onclose 时 streaming 仍为 true，通常是异常关闭；
              // 当前实现不执行重连，直接按扫描结束处理
              // setIsScanning(false)
            }
          },

          onerror(err) {
            if (err instanceof FatalError) {
              logger.error(`Fatal Error: ${err.message}`)
              throw err // 停止重试并上抛致命错误
            }
            logger.warn(`Connection error: ${err.message}. Retrying...`)
            // 使用 fetch-event-source 的默认重试策略
          }
        })
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // 用户主动取消导致的正常中断
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
    setJobId(null)
    setScanRunId(null)
  }, [logger, storeClearLogs])

  return {
    state: {
      streaming: isScanning,
      progress,
      streamResult: result,
      streamError: error,
      jobId,
      scanRunId,
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
