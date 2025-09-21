'use client'

import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson, createEventSourceWithAuth } from '@/lib/api'
import { ScanResult, HealthResponse, ScanProgress, LogEntry, ScanPathResponse } from '@pixishelf/shared'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { useNotification } from '@/components/ui/notification'
import { useToast } from '@/components/ui/toast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

// Hook: 健康检查
function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      return apiJson<HealthResponse>('/api/v1/health')
    }
  })
}

// Hook: 扫描路径管理
function useScanPath() {
  const queryClient = useQueryClient()
  return {
    query: useQuery({
      queryKey: ['scanPath'],
      queryFn: async () => {
        return apiJson<ScanPathResponse>('/api/v1/settings/scan-path')
      }
    }),
    update: useMutation({
      mutationFn: async (scanPath: string) => {
        return apiJson('/api/v1/settings/scan-path', {
          method: 'PUT',
          body: JSON.stringify({ scanPath })
        })
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['scanPath'] })
        queryClient.invalidateQueries({ queryKey: ['health'] })
      }
    })
  }
}

// Hook: 取消扫描
function useCancelScan() {
  return useMutation({
    mutationFn: async () => {
      return apiJson<{ success: boolean; cancelled: boolean }>('/api/v1/scan/cancel', {
        method: 'POST'
      })
    }
  })
}

// 工具函数：秒数转时间文本
function secondsToText(s: number) {
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/**
 * 扫描管理组件
 *
 * 功能：
 * - 扫描路径配置和管理
 * - 实时扫描进度显示（SSE）
 * - 扫描操作控制
 * - 详细扫描日志查看
 * - 错误处理和状态管理
 *
 * 迁移自原Settings.tsx，保持所有功能不变
 */
function ScanManagement() {
  const [toast] = useToast()
  const { data: health } = useHealth()
  const scanPath = useScanPath()
  const cancelScan = useCancelScan()
  const { addNotification } = useNotification()

  const [editPath, setEditPath] = React.useState('')
  const [editing, setEditing] = React.useState(false)
  // 固定使用unified策略
  const selectedStrategy = 'unified'

  const [elapsed, setElapsed] = React.useState(0)
  const [progress, setProgress] = React.useState<ScanProgress | null>(null)
  const [streaming, setStreaming] = React.useState(false)
  const streamingRef = React.useRef(streaming)
  React.useEffect(() => {
    streamingRef.current = streaming
  }, [streaming])
  const [streamResult, setStreamResult] = React.useState<ScanResult | null>(null)
  const [streamError, setStreamError] = React.useState<string | null>(null)
  const [retryCount, setRetryCount] = React.useState(0)

  // 详细日志相关状态
  const [logs, setLogs] = React.useState<LogEntry[]>([])
  const [showDetailedLogs, setShowDetailedLogs] = React.useState(false)
  const [autoScroll, setAutoScroll] = React.useState(true)
  const logsEndRef = React.useRef<HTMLDivElement>(null)

  // 强制扫描确认弹窗状态
  const [showForceConfirm, setShowForceConfirm] = React.useState(false)
  const esRef = React.useRef<EventSource | null>(null)

  // 添加日志条目的函数
  const addLogEntry = React.useCallback((type: LogEntry['type'], data: any, message: string) => {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      data,
      message
    }
    setLogs((prev) => [...prev, entry])
  }, [])

  // 自动滚动到底部
  React.useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  // 计时器效果
  React.useEffect(() => {
    let timer: any
    if (streaming) {
      setElapsed(0)
      const started = Date.now()
      timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    }
    return () => timer && clearInterval(timer)
  }, [streaming])

  // 开始编辑路径
  const startEditing = () => {
    setEditPath(scanPath.query.data?.scanPath || '')
    setEditing(true)
  }

  // 保存编辑路径
  const saveEditPath = () => {
    if (!editPath.trim()) return
    scanPath.update.mutate(editPath.trim(), {
      onSuccess: () => setEditing(false)
    })
  }

  // 开始SSE流
  const startStream = React.useCallback(
    (force?: boolean) => {
      // 若已存在连接，先关闭
      if (esRef.current) {
        try {
          esRef.current.close()
        } catch {}
        esRef.current = null
        addLogEntry('connection', null, '关闭已有的 SSE 连接')
      }

      setStreaming(true)
      setProgress(null)
      setStreamResult(null)
      setStreamError(null)
      setRetryCount(0)
      setLogs([]) // 清空之前的日志

      const qs = new URLSearchParams()
      if (force) qs.set('force', 'true')
      const url = `/api/v1/scan/stream${qs.toString() ? `?${qs.toString()}` : ''}`

      addLogEntry('connection', { url, force }, `开始连接SSE: ${url}`)

      const connectSSE = () => {
        const es = createEventSourceWithAuth(url)
        esRef.current = es

        es.addEventListener('open', () => {
          addLogEntry('connection', null, 'SSE 连接已建立')
        })

        es.addEventListener('progress', (ev: any) => {
          try {
            const data = JSON.parse(ev.data) as ScanProgress
            setProgress(data)
            addLogEntry('progress', data, `进度更新: ${data.message} (${data.percentage || 0}%)`)
          } catch (e) {
            console.warn('Failed to parse progress event:', e)
            addLogEntry('error', { error: e, rawData: ev.data }, '解析进度事件失败')
          }
        })

        es.addEventListener('complete', (ev: any) => {
          try {
            const data = JSON.parse(ev.data) as {
              success: boolean
              result: ScanResult
            }
            setStreamResult(data.result)
            setStreaming(false)
            addLogEntry(
              'complete',
              data,
              `扫描完成: 新增${data.result.newArtworks}个作品，${data.result.newImages}张图片`
            )

            es.close()
            esRef.current = null
            addLogEntry('connection', null, 'SSE 连接已关闭')
            toast.success('扫描完成')
          } catch (e) {
            console.warn('Failed to parse complete event:', e)
            addLogEntry('error', { error: e, rawData: ev.data }, '解析完成事件失败')
          }
        })

        es.addEventListener('error', (ev: any) => {
          try {
            const data = JSON.parse(ev.data) as {
              success: boolean
              error: string
            }
            setStreamError(data.error || '未知错误')
            setStreaming(false)
            addLogEntry('error', data, `扫描错误: ${data.error || '未知错误'}`)
            es.close()
            esRef.current = null
            addLogEntry('connection', null, 'SSE 连接已关闭')
          } catch (e) {
            console.warn('Failed to parse error event:', e)
            addLogEntry('error', { error: e, rawData: ev.data }, '解析错误事件失败')
          }
        })

        es.addEventListener('cancelled', (ev: any) => {
          try {
            const data = JSON.parse(ev.data) as {
              success: boolean
              error: string
            }
            setStreamError('扫描已取消')
            setStreaming(false)
            addLogEntry('cancelled', data, '扫描已取消')
            es.close()
            esRef.current = null
            addLogEntry('connection', null, 'SSE 连接已关闭')
          } catch (e) {
            console.warn('Failed to parse cancelled event:', e)
            addLogEntry('error', { error: e, rawData: ev.data }, '解析取消事件失败')
          }
        })
        ;(es as any).onerror = () => {
          if (retryCount < 3) {
            setRetryCount((prev) => prev + 1)
            addLogEntry('connection', { retryCount: retryCount + 1 }, `连接中断，准备第${retryCount + 1}次重连`)
            setTimeout(
              () => {
                if (streamingRef.current) connectSSE()
              },
              2000 * (retryCount + 1)
            )
          } else {
            setStreamError('连接中断，重试次数已达上限')
            setStreaming(false)
            addLogEntry('error', { retryCount }, '连接中断，重试次数已达上限')
          }
          es.close()
          esRef.current = null
          addLogEntry('connection', null, 'SSE 连接已关闭')
        }
      }

      connectSSE()
    },
    [retryCount, streaming, addLogEntry, selectedStrategy]
  )

  // 取消当前扫描
  const cancelCurrentScan = () => {
    cancelScan.mutate(undefined, {
      onSuccess: (data) => {
        if (data.cancelled) {
          // 主动关闭当前 SSE 连接，避免等待服务器推送取消事件
          if (esRef.current) {
            try {
              esRef.current.close()
            } catch {}
            esRef.current = null
            addLogEntry('connection', null, '用户取消：关闭 SSE 连接')
          }
          setStreaming(false)
          setStreamError('扫描已取消')
          setProgress(null)
          addLogEntry('cancelled', data, '用户手动取消扫描')
        }
      }
    })
  }

  // 组件卸载时清理 SSE 连接
  React.useEffect(() => {
    return () => {
      if (esRef.current) {
        try {
          esRef.current.close()
        } catch {}
        esRef.current = null
      }
    }
  }, [])

  // 清空日志函数
  const clearLogs = () => {
    setLogs([])
  }

  // 获取日志类型的样式
  const getLogTypeStyle = (type: LogEntry['type']) => {
    switch (type) {
      case 'progress':
        return 'text-blue-600'
      case 'complete':
        return 'text-green-600'
      case 'error':
        return 'text-red-600'
      case 'cancelled':
        return 'text-orange-600'
      case 'connection':
        return 'text-purple-600'
      default:
        return 'text-gray-600'
    }
  }

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 页面标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-neutral-900 mb-2">扫描管理</h1>
          <p className="text-neutral-600">管理艺术品扫描路径、监控扫描进度和查看详细日志</p>
        </div>

        {/* 扫描路径配置 */}
        <Card>
          <CardHeader>
            <CardTitle>扫描路径配置</CardTitle>
          </CardHeader>
          <CardContent>
            {!editing ? (
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className="font-mono text-sm">
                  {scanPath.query.data?.scanPath || '未配置'}
                </Badge>
                <Button variant="link" size="sm" onClick={startEditing} className="h-auto p-0">
                  修改
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={editPath}
                  onChange={(e) => setEditPath(e.target.value)}
                  placeholder="请输入扫描目录的绝对路径"
                  className="flex-1"
                />
                <Button onClick={saveEditPath} disabled={scanPath.update.isPending || !editPath.trim()}>
                  {scanPath.update.isPending ? '保存中' : '保存'}
                </Button>
              </div>
            )}

            <div className="flex items-center gap-3 text-sm text-neutral-600 mt-4">
              <div>
                后端健康：
                <Badge variant={health?.status === 'ok' ? 'default' : 'destructive'} className="ml-1">
                  {health?.status || '加载中…'}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 实时进度（SSE） */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>实时进度（SSE）</CardTitle>
                <CardDescription>使用 Server-Sent Events 实时显示扫描进度。支持自动重连。</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => startStream(false)} disabled={streaming || !scanPath.query.data?.scanPath}>
                  {streaming ? '进行中…' : '增量扫描'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowForceConfirm(true)}
                  disabled={streaming || !scanPath.query.data?.scanPath}
                  title="强制全量更新：清空现有数据后重建"
                >
                  强制全量
                </Button>
                {streaming && (
                  <Button variant="destructive" onClick={cancelCurrentScan} disabled={cancelScan.isPending}>
                    {cancelScan.isPending ? '取消中' : '取消'}
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {streaming && (
              <div className="space-y-2">
                <div className="h-2 w-full overflow-hidden rounded bg-neutral-200">
                  <div className="h-2 w-1/3 animate-[progress_1.2s_ease-in-out_infinite] rounded bg-blue-500" />
                </div>
                <div className="text-sm text-neutral-600">
                  {progress?.message || '准备中…'} 已用时 {secondsToText(elapsed)}
                  {retryCount > 0 && ` (重连第${retryCount}次)`}
                </div>
              </div>
            )}

            {streamError && (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                实时通道：{streamError}
              </div>
            )}

            {streamResult && (
              <div className="mt-3 space-y-2 text-sm">
                <div className="text-green-700">扫描完成（SSE）</div>
                <div className="grid grid-cols-2 gap-2">
                  <Card className="p-3">
                    <div className="text-sm text-neutral-600">发现作品</div>
                    <div className="text-lg font-medium">{streamResult.totalArtworks}</div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-sm text-neutral-600">新增作品</div>
                    <div className="text-lg font-medium">{streamResult.newArtworks}</div>
                  </Card>
                  <Card className="p-3">
                    <div className="text-sm text-neutral-600">新增图片</div>
                    <div className="text-lg font-medium">{streamResult.newImages}</div>
                  </Card>
                  {typeof streamResult.removedArtworks === 'number' && (
                    <Card className="p-3">
                      <div className="text-sm text-neutral-600">删除空作品</div>
                      <div className="text-lg font-medium">{streamResult.removedArtworks}</div>
                    </Card>
                  )}
                </div>
                {streamResult.errors?.length > 0 && (
                  <details className="rounded border bg-yellow-50 p-3">
                    <summary className="cursor-pointer text-yellow-800">
                      错误 {streamResult.errors.length} 条（展开查看）
                    </summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-yellow-900">
                      {streamResult.errors.slice(0, 20).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                      {streamResult.errors.length > 20 && <li>… 仅展示前 20 条</li>}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {/* 详细日志区域 */}
            {logs.length > 0 && (
              <div className="mt-4 border-t pt-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setShowDetailedLogs(!showDetailedLogs)}
                      className="h-auto p-0"
                    >
                      {showDetailedLogs ? '隐藏' : '显示'}详细日志 ({logs.length}条)
                    </Button>
                    {showDetailedLogs && (
                      <>
                        <Button variant="link" size="sm" onClick={clearLogs} className="h-auto p-0 text-xs">
                          清空日志
                        </Button>
                        <label className="flex items-center gap-1 text-xs text-neutral-500">
                          <input
                            type="checkbox"
                            checked={autoScroll}
                            onChange={(e) => setAutoScroll(e.target.checked)}
                            className="h-3 w-3"
                          />
                          自动滚动
                        </label>
                      </>
                    )}
                  </div>
                </div>

                {showDetailedLogs && (
                  <div className="max-h-96 overflow-y-auto rounded border bg-neutral-50 p-3">
                    <div className="space-y-1 font-mono text-xs">
                      {logs.map((log, index) => (
                        <div key={index} className="flex gap-2">
                          <span className="text-neutral-400 shrink-0">{log.timestamp}</span>
                          <Badge variant="outline" className={`shrink-0 text-xs ${getLogTypeStyle(log.type)}`}>
                            {log.type.toUpperCase()}
                          </Badge>
                          <span className="text-neutral-700">{log.message}</span>
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 进度动画样式 */}
        <style>{`
          @keyframes progress {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(0%); }
            100% { transform: translateX(100%); }
          }
        `}</style>
      </div>

      {/* 强制扫描确认弹窗 */}
      <AlertDialog open={showForceConfirm} onOpenChange={setShowForceConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认强制全量扫描</AlertDialogTitle>
            <AlertDialogDescription>
              强制全量扫描将会清空数据库中的所有艺术品、艺术家、图片和标签数据（用户和设置数据不受影响），然后重新扫描所有文件。此操作不可撤销，确定要继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                setShowForceConfirm(false)
                startStream(true)
              }}
            >
              确认清空并扫描
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default ScanManagement
