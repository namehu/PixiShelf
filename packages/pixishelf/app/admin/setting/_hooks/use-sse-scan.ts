import React from 'react'
import { toast } from 'sonner'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { formatScanHttpErrorText } from '@/services/scan-service/scan-errors'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

const sensitiveDescription = (message: string) => React.createElement(PrivacySensitiveText, null, message)

class FatalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FatalError'
  }
}

type ScanOptions =
  | { metadataList?: undefined }
  | {
      metadataList: string[]
    }

interface SseScanState {
  streaming: boolean
  jobId: string | null
  scanRunId: string | null
}

interface SseScanActions {
  startScan: (options: ScanOptions) => void
}

interface QueuedScan {
  jobId?: unknown
  scanRunId?: unknown
}

/**
 * 扫描请求只使用 SSE 确认“已入队”。实际执行状态由 Worker 写入 SystemJob，
 * 并由页面的任务状态查询展示；断开浏览器连接不会取消已入队的 Worker 任务。
 */
export function useSseScan({ onQueued }: { onQueued?: () => void } = {}): {
  state: SseScanState
  actions: SseScanActions
} {
  const [streaming, setStreaming] = React.useState(false)
  const [jobId, setJobId] = React.useState<string | null>(null)
  const [scanRunId, setScanRunId] = React.useState<string | null>(null)
  const fetchControllerRef = React.useRef<AbortController | null>(null)
  const streamingRef = React.useRef(false)

  const updateStreaming = React.useCallback((nextStreaming: boolean) => {
    streamingRef.current = nextStreaming
    setStreaming(nextStreaming)
  }, [])

  React.useEffect(() => {
    return () => {
      fetchControllerRef.current?.abort()
    }
  }, [])

  const runScan = React.useCallback(
    async (options: ScanOptions) => {
      const isListScan = options.metadataList && options.metadataList.length > 0
      const controller = new AbortController()
      let receivedTerminalEvent = false
      let unexpectedCloseReported = false
      let retryWarningShown = false
      fetchControllerRef.current = controller
      setJobId(null)
      setScanRunId(null)

      try {
        await fetchEventSource('/api/scan/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: isListScan ? 'list' : 'full',
            metadataList: options.metadataList
          }),
          signal: controller.signal,

          async onopen(response) {
            if (response.ok) {
              updateStreaming(true)
              return
            }
            const message = formatScanHttpErrorText(await response.text()).trim()
            throw new FatalError(message || `扫描请求失败（HTTP ${response.status}）`)
          },

          onmessage(message) {
            if (message.event === 'ping') return

            try {
              const data = JSON.parse(message.data)

              if (message.event === 'queued') {
                const queued = (data?.queued ?? {}) as QueuedScan
                const queuedJobId = typeof queued.jobId === 'string' ? queued.jobId : null
                const queuedRunId = typeof queued.scanRunId === 'string' ? queued.scanRunId : null
                setJobId(queuedJobId)
                setScanRunId(queuedRunId)
                receivedTerminalEvent = true
                updateStreaming(false)
                onQueued?.()
                toast.info('扫描任务已加入后台队列', {
                  description: queuedJobId ? `任务 ID: ${queuedJobId}` : undefined
                })
                return
              }

              if (message.event === 'complete') {
                receivedTerminalEvent = true
                updateStreaming(false)
                toast.success('扫描完成')
                return
              }

              if (message.event === 'error') {
                receivedTerminalEvent = true
                updateStreaming(false)
                toast.error('扫描任务失败', {
                  description: data?.error ? sensitiveDescription(String(data.error)) : '未知错误'
                })
                return
              }

              if (message.event === 'cancelled') {
                receivedTerminalEvent = true
                updateStreaming(false)
                toast.info('扫描已取消')
              }
            } catch {
              receivedTerminalEvent = true
              updateStreaming(false)
              toast.error('扫描响应无法读取')
            }
          },

          onclose() {
            if (receivedTerminalEvent || controller.signal.aborted) return

            unexpectedCloseReported = true
            updateStreaming(false)
            toast.error('扫描任务连接已关闭', { description: '未收到任务终态，请刷新查看后台任务状态。' })
          },

          onerror(error) {
            if (error instanceof FatalError) throw error
            if (!retryWarningShown) {
              retryWarningShown = true
              toast.error('扫描任务连接中断，正在重试')
            }
          }
        })
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return

        updateStreaming(false)
        if (!unexpectedCloseReported) {
          toast.error('扫描任务提交失败', {
            description:
              error instanceof Error ? sensitiveDescription(error.message) : '请检查网络连接后重试。'
          })
        }
      } finally {
        if (fetchControllerRef.current === controller) {
          fetchControllerRef.current = null
        }
      }
    },
    [onQueued, updateStreaming]
  )

  const startScan = React.useCallback(
    (options: ScanOptions) => {
      if (streamingRef.current) return
      void runScan(options)
    },
    [runScan]
  )

  return {
    state: { streaming, jobId, scanRunId },
    actions: { startScan }
  }
}
