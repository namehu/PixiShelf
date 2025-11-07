import React from 'react'
import { toast } from 'sonner'
import { ScanResult, ScanProgress, LogEntry } from '@/types'

/**
 * SSE 扫描策略的启动选项
 */
type ScanOptions = {
  /** 强制全量扫描 (用于 GET 策略) */
  force?: boolean
  /** 客户端提供的元数据列表 (用于 POST 策略) */
  metadataList?: string[]
}

/**
 * Hook 返回的状态
 */
type SseScanState = {
  streaming: boolean
  progress: ScanProgress | null
  streamResult: ScanResult | null
  streamError: string | null
  logs: LogEntry[]
  elapsed: number
  retryCount: number
}

/**
 * Hook 返回的动作
 */
type SseScanActions = {
  startScan: (options: ScanOptions) => void
  cancelScan: () => void
  clearLogs: () => void
  /** 用于日志组件的手动滚动 */
  setAutoScroll: (auto: boolean) => void
  /** 用于日志组件的显示切换 */
  setShowDetailedLogs: (show: boolean) => void
  /** 日志组件的状态 */
  showDetailedLogs: boolean
  autoScroll: boolean
}

const INITIAL_STATE: SseScanState = {
  streaming: false,
  progress: null,
  streamResult: null,
  streamError: null,
  logs: [],
  elapsed: 0,
  retryCount: 0
}

/**
 * 封装 SSE 扫描逻辑 (GET/POST) 的统一 Hook
 */
export function useSseScan(): { state: SseScanState; actions: SseScanActions } {
  const [state, setState] = React.useState<SseScanState>(INITIAL_STATE)

  // 日志 UI 状态
  const [showDetailedLogs, setShowDetailedLogs] = React.useState(false)
  const [autoScroll, setAutoScroll] = React.useState(true)

  // 内部引用
  const esRef = React.useRef<EventSource | null>(null)
  const fetchControllerRef = React.useRef<AbortController | null>(null)
  const streamingRef = React.useRef(false) // 用于在异步回调中检查最新状态

  React.useEffect(() => {
    streamingRef.current = state.streaming
  }, [state.streaming])

  // 计时器
  React.useEffect(() => {
    let timer: any
    if (state.streaming) {
      const started = Date.now()
      // 重置计时器
      setState((s) => ({ ...s, elapsed: 0 }))
      timer = setInterval(() => {
        setState((s) => ({ ...s, elapsed: Math.floor((Date.now() - started) / 1000) }))
      }, 1000)
    }
    return () => timer && clearInterval(timer)
  }, [state.streaming])

  // 组件卸载时清理
  React.useEffect(() => {
    return () => {
      esRef.current?.close()
      fetchControllerRef.current?.abort()
    }
  }, [])

  // --- 内部辅助函数 ---

  /** 1. 添加日志条目 */
  const addLogEntry = React.useCallback((type: LogEntry['type'], data: any, message: string) => {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      data,
      message
    }
    setState((prev) => ({ ...prev, logs: [...prev.logs, entry] }))
  }, [])

  /** 2. 统一事件处理器 (收敛的核心) */
  const handleSseEvent = React.useCallback(
    (eventName: string, data: any) => {
      switch (eventName) {
        case 'connection':
          addLogEntry('connection', data, data?.result || '连接已建立')
          break

        case 'progress':
          const progressData = data as ScanProgress
          setState((s) => ({ ...s, progress: progressData }))
          addLogEntry('progress', progressData, `进度: ${progressData.message} (${progressData.percentage || 0}%)`)
          break

        case 'complete':
          const completeData = data as { success: boolean; result: ScanResult }
          setState((s) => ({ ...s, streaming: false, streamResult: completeData.result, streamError: null }))
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
          setState((s) => ({ ...s, streaming: false, streamError: errorMsg, streamResult: null }))
          addLogEntry('error', errorData, `错误: ${errorMsg}`)
          break

        case 'cancelled':
          setState((s) => ({ ...s, streaming: false, streamError: '扫描已取消', streamResult: null }))
          addLogEntry('cancelled', data, '扫描已取消')
          break
      }

      // 结束事件，关闭连接
      if (['complete', 'error', 'cancelled'].includes(eventName)) {
        esRef.current?.close()
        esRef.current = null
        // fetchControllerRef 由其自己的逻辑关闭
      }
    },
    [addLogEntry]
  )

  /** 3. GET 策略 (EventSource) */
  const runGetStrategy = (options: ScanOptions) => {
    const qs = new URLSearchParams()
    if (options.force) qs.set('force', 'true')
    const url = `/api/scan/stream${qs.toString() ? `?${qs.toString()}` : ''}`
    addLogEntry('connection', { url, strategy: 'GET' }, `开始连接(GET): ${url}`)

    const connect = () => {
      if (!streamingRef.current) return // 检查是否在重试期间被取消

      const es = new EventSource(url)
      esRef.current = es

      // 连接建立事件（浏览器级）
      es.addEventListener('open', () => handleSseEvent('connection', null))
      // 服务端显式的 connection 事件（可选，统一日志）
      es.addEventListener('connection', (ev: any) => {
        try {
          handleSseEvent('connection', JSON.parse(ev.data))
        } catch (e) {
          addLogEntry('error', { error: e, rawData: ev?.data }, '解析连接事件失败')
        }
      })
      // 业务事件解析增加健壮性
      es.addEventListener('progress', (ev: any) => {
        try {
          handleSseEvent('progress', JSON.parse(ev.data))
        } catch (e) {
          addLogEntry('error', { error: e, rawData: ev?.data }, '解析进度事件失败')
        }
      })
      es.addEventListener('complete', (ev: any) => {
        try {
          handleSseEvent('complete', JSON.parse(ev.data))
        } catch (e) {
          addLogEntry('error', { error: e, rawData: ev?.data }, '解析完成事件失败')
        }
      })
      es.addEventListener('error', (ev: any) => {
        try {
          handleSseEvent('error', JSON.parse(ev.data))
        } catch (e) {
          // 注意：这里处理的是服务端的 error 事件，而非网络错误
          addLogEntry('error', { error: e, rawData: ev?.data }, '解析错误事件失败')
        }
      })
      es.addEventListener('cancelled', (ev: any) => {
        try {
          handleSseEvent('cancelled', JSON.parse(ev.data))
        } catch (e) {
          addLogEntry('error', { error: e, rawData: ev?.data }, '解析取消事件失败')
        }
      })

      // 处理网络错误和重连
      ;(es as any).onerror = () => {
        setState((s) => {
          if (s.retryCount < 3 && streamingRef.current) {
            const newRetryCount = s.retryCount + 1
            addLogEntry('connection', { retryCount: newRetryCount }, `连接中断，准备第${newRetryCount}次重连`)
            setTimeout(connect, 2000 * newRetryCount) // 指数退避
            return { ...s, retryCount: newRetryCount }
          } else {
            addLogEntry('error', { retryCount: s.retryCount }, '连接中断，重试次数已达上限')
            return { ...s, streaming: false, streamError: '连接中断，重试失败' }
          }
        })
        es.close() // 关闭失败的连接
        esRef.current = null // 清理引用，避免悬挂实例
      }
    }
    connect()
  }

  /** 4. POST 策略 (Fetch + Manual Parse) - 已增强 */
  const runPostStrategy = React.useCallback(
    async (options: ScanOptions) => {
      const url = `/api/scan/stream`
      addLogEntry(
        'connection',
        { url, strategy: 'POST', items: options.metadataList?.length },
        `开始连接(POST): ${url}`
      )

      const connect = async () => {
        if (!streamingRef.current) return

        const controller = new AbortController()
        fetchControllerRef.current = controller

        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            signal: controller.signal,
            body: JSON.stringify({ metadataList: options.metadataList })
          })

          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`)
          }
          if (!res.body) {
            throw new Error('Response body is null')
          }

          // 重置重连次数
          setState((s) => ({ ...s, retryCount: 0 }))

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            const parts = buffer.split(/\n\n/) // SSE 事件以空行分隔
            buffer = parts.pop() || '' // 保留最后一个不完整的部分

            for (const part of parts) {
              if (!part.trim()) continue

              let event: string | null = null
              const dataLines: string[] = [] // !! 修复：用于收集多行 data

              for (const line of part.split(/\n/)) {
                if (line.startsWith('event:')) {
                  event = line.slice(6).trim()
                } else if (line.startsWith('data:')) {
                  dataLines.push(line.slice(5)) // !! 修复：保留原始格式
                }
              }

              if (!event) continue
              const dataStr = dataLines.join('\n') // !! 修复：用换行符重新组合
              let payload: any = null

              try {
                payload = dataStr ? JSON.parse(dataStr) : null
                handleSseEvent(event, payload)
              } catch (e) {
                addLogEntry('error', { error: e, rawData: dataStr }, '解析SSE数据失败')
              }

              // 结束事件，主动停止读取
              if (['complete', 'error', 'cancelled'].includes(event)) {
                await reader.cancel()
                fetchControllerRef.current = null
                return
              }
            }
          }
        } catch (error: any) {
          if (controller.signal.aborted) {
            // 用户主动取消，handleSseEvent('cancelled') 会在 cancelScan 中调用
            addLogEntry('cancelled', null, '用户已取消 POST 流')
            return
          }

          // !! 增强：添加重连逻辑
          setState((s) => {
            if (s.retryCount < 3 && streamingRef.current) {
              const newRetryCount = s.retryCount + 1
              addLogEntry(
                'connection',
                { retryCount: newRetryCount, error: error.message },
                `POST 流错误，准备第${newRetryCount}次重连`
              )
              setTimeout(connect, 2000 * newRetryCount)
              return { ...s, retryCount: newRetryCount }
            } else {
              addLogEntry('error', { retryCount: s.retryCount, error: error.message }, 'POST 流错误，重试次数已达上限')
              return { ...s, streaming: false, streamError: `连接失败: ${error.message}` }
            }
          })
        } finally {
          if (fetchControllerRef.current === controller) {
            fetchControllerRef.current = null
          }
        }
      }
      connect()
    },
    [handleSseEvent, addLogEntry]
  )

  // --- 暴露的动作 ---

  /**
   * 启动扫描（门面）
   */
  const startScan = React.useCallback(
    (options: ScanOptions) => {
      // 关闭任何现有的连接
      esRef.current?.close()
      fetchControllerRef.current?.abort()

      // 重置状态
      setState(INITIAL_STATE)
      setShowDetailedLogs(false) // 重置时先折叠日志

      setState((s) => ({ ...s, streaming: true, logs: [] })) // 清空日志
      streamingRef.current = true

      if (options.metadataList && options.metadataList.length > 0) {
        runPostStrategy(options)
      } else {
        runGetStrategy(options)
      }
    },
    [runGetStrategy, runPostStrategy]
  )

  /**
   * 取消扫描（客户端）
   * 注意：这只负责停止客户端的监听。
   * 服务端的取消应由组件的 `useCancelScan` mutation 触发。
   */
  const cancelScan = React.useCallback(() => {
    esRef.current?.close()
    esRef.current = null
    fetchControllerRef.current?.abort()
    fetchControllerRef.current = null

    if (streamingRef.current) {
      // 仅在仍在进行中时才标记为“已取消”
      handleSseEvent('cancelled', { client: true, message: 'User cancelled' })
    }
  }, [handleSseEvent])

  /**
   * 清空日志
   */
  const clearLogs = React.useCallback(() => {
    setState((s) => ({ ...s, logs: [] }))
  }, [])

  return {
    state,
    actions: {
      startScan,
      cancelScan,
      clearLogs,
      autoScroll,
      setAutoScroll,
      showDetailedLogs,
      setShowDetailedLogs
    }
  }
}
