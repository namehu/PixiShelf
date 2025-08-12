import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson, apiRequest, createEventSourceWithAuth } from '../api'

type ScanResult = {
  scannedDirectories: number
  foundImages: number
  newArtworks: number
  newImages: number
  removedArtworks?: number
  errors: string[]
}

type Health = { status: string; scanPath: string | null }

type ScanProgress = {
  phase: 'scanning' | 'creating' | 'cleanup' | 'complete'
  message: string
  current?: number
  total?: number
  percentage?: number
}

function authHeader() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      return apiJson<Health>('/api/v1/health')
    },
  })
}

function useScanPath() {
  const queryClient = useQueryClient()
  return {
    query: useQuery({
      queryKey: ['scanPath'],
      queryFn: async () => {
        return apiJson<{ scanPath: string | null }>('/api/v1/settings/scan-path')
      },
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

function useManualScan() {
  return useMutation({
    mutationFn: async (force?: boolean) => {
      return apiJson<{ success: boolean; result: ScanResult }>('/api/v1/scan', {
        method: 'POST',
        body: JSON.stringify({ force: !!force })
      })
    },
  })
}

function useCancelScan() {
  return useMutation({
    mutationFn: async () => {
      return apiJson<{ success: boolean; cancelled: boolean }>('/api/v1/scan/cancel', {
        method: 'POST',
      })
    },
  })
}

function secondsToText(s: number) {
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

const useEventSource = typeof window !== 'undefined' ? (url: string) => new EventSource(url) : null

export default function Settings() {
  const { data: health } = useHealth()
  const scanPath = useScanPath()
  const scan = useManualScan()
  const cancelScan = useCancelScan()
  
  const [editPath, setEditPath] = React.useState('')
  const [editing, setEditing] = React.useState(false)
  
  const [elapsed, setElapsed] = React.useState(0)
  const [progress, setProgress] = React.useState<ScanProgress | null>(null)
  const [streaming, setStreaming] = React.useState(false)
  const [streamResult, setStreamResult] = React.useState<ScanResult | null>(null)
  const [streamError, setStreamError] = React.useState<string | null>(null)
  const [retryCount, setRetryCount] = React.useState(0)

  React.useEffect(() => {
    let timer: any
    if (scan.isPending || streaming) {
      setElapsed(0)
      const started = Date.now()
      timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    }
    return () => timer && clearInterval(timer)
  }, [scan.isPending, streaming])

  const startEditing = () => {
    setEditPath(scanPath.query.data?.scanPath || '')
    setEditing(true)
  }

  const saveEditPath = () => {
    if (!editPath.trim()) return
    scanPath.update.mutate(editPath.trim(), {
      onSuccess: () => setEditing(false)
    })
  }

  const startStream = React.useCallback((force?: boolean) => {
    setStreaming(true)
    setProgress(null)
    setStreamResult(null)
    setStreamError(null)
    setRetryCount(0)

    const qs = new URLSearchParams()
    if (force) qs.set('force', 'true')
    const url = `/api/v1/scan/stream${qs.toString() ? `?${qs.toString()}` : ''}`

    const connectSSE = () => {
      const es = createEventSourceWithAuth(url)

      es.addEventListener('progress', (ev: any) => {
        try {
          const data = JSON.parse(ev.data) as ScanProgress
          setProgress(data)
        } catch (e) {
          console.warn('Failed to parse progress event:', e)
        }
      })

      es.addEventListener('complete', (ev: any) => {
        try {
          const data = JSON.parse(ev.data) as { success: boolean; result: ScanResult }
          setStreamResult(data.result)
          setStreaming(false)
          es.close()
        } catch (e) {
          console.warn('Failed to parse complete event:', e)
        }
      })

      es.addEventListener('error', (ev: any) => {
        try {
          const data = JSON.parse(ev.data) as { success: boolean; error: string }
          setStreamError(data.error || '未知错误')
          setStreaming(false)
          es.close()
        } catch (e) {
          console.warn('Failed to parse error event:', e)
        }
      })

      es.addEventListener('cancelled', (ev: any) => {
        try {
          const data = JSON.parse(ev.data) as { success: boolean; error: string }
          setStreamError('扫描已取消')
          setStreaming(false)
          es.close()
        } catch (e) {
          console.warn('Failed to parse cancelled event:', e)
        }
      })

      ;(es as any).onerror = () => {
        if (retryCount < 3) {
          setRetryCount(prev => prev + 1)
          setTimeout(() => {
            if (streaming) connectSSE()
          }, 2000 * (retryCount + 1))
        } else {
          setStreamError('连接中断，重试次数已达上限')
          setStreaming(false)
        }
        es.close()
      }
    }

    connectSSE()
  }, [retryCount, streaming])

  const cancelCurrentScan = () => {
    cancelScan.mutate(undefined, {
      onSuccess: (data) => {
        if (data.cancelled) {
          setStreaming(false)
          setStreamError('扫描已取消')
          setProgress(null)
        }
      }
    })
  }

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">设置</h2>

      <div className="rounded-lg border bg-white p-5">
        <div className="mb-4">
          <div className="mb-2 text-base font-medium">扫描路径配置</div>
          {!editing ? (
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                {scanPath.query.data?.scanPath || '未配置'}
              </span>
              <button
                onClick={startEditing}
                className="text-sm text-brand-600 hover:text-brand-700"
              >
                修改
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editPath}
                onChange={(e) => setEditPath(e.target.value)}
                placeholder="请输入扫描目录的绝对路径"
                className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                onClick={saveEditPath}
                disabled={scanPath.update.isPending || !editPath.trim()}
                className="rounded bg-brand-600 px-3 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {scanPath.update.isPending ? '保存中' : '保存'}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-sm text-gray-600">
          <div>后端健康：<span className={health?.status === 'ok' ? 'text-green-700' : 'text-red-700'}>{health?.status || '加载中…'}</span></div>
          <div>扫描路径：<span className="font-mono">{scanPath.query.data?.scanPath || '未配置'}</span></div>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-medium">实时进度（SSE）</div>
            <div className="text-sm text-gray-500">使用 Server-Sent Events 实时显示扫描进度。支持自动重连。</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => startStream(false)}
              disabled={scan.isPending || streaming || !scanPath.query.data?.scanPath}
              className="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
            >{streaming ? '进行中…' : '开始（SSE）'}</button>
            <button
              onClick={() => startStream(true)}
              disabled={scan.isPending || streaming || !scanPath.query.data?.scanPath}
              className="rounded border border-brand-600 px-3 py-2 text-brand-700 hover:bg-brand-50 disabled:opacity-50"
              title="强制全量更新：清空现有数据后重建（SSE）"
            >强制全量（SSE）</button>
            {streaming && (
              <button
                onClick={cancelCurrentScan}
                disabled={cancelScan.isPending}
                className="rounded border border-red-600 px-3 py-2 text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {cancelScan.isPending ? '取消中' : '取消'}
              </button>
            )}
          </div>
        </div>

        {streaming && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
              <div className="h-2 w-1/3 animate-[progress_1.2s_ease-in-out_infinite] rounded bg-brand-500" />
            </div>
            <div className="text-sm text-gray-600">
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
            <ul className="grid grid-cols-2 gap-2">
              <li className="rounded border bg-gray-50 p-2">扫描目录：<span className="font-medium">{streamResult.scannedDirectories}</span></li>
              <li className="rounded border bg-gray-50 p-2">发现图片：<span className="font-medium">{streamResult.foundImages}</span></li>
              <li className="rounded border bg-gray-50 p-2">新增作品：<span className="font-medium">{streamResult.newArtworks}</span></li>
              <li className="rounded border bg-gray-50 p-2">新增图片：<span className="font-medium">{streamResult.newImages}</span></li>
              {typeof streamResult.removedArtworks === 'number' && <li className="rounded border bg-gray-50 p-2">删除空作品：<span className="font-medium">{streamResult.removedArtworks}</span></li>}
            </ul>
            {streamResult.errors?.length > 0 && (
              <details className="rounded border bg-yellow-50 p-3">
                <summary className="cursor-pointer text-yellow-800">错误 {streamResult.errors.length} 条（展开查看）</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-yellow-900">
                  {streamResult.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                  {streamResult.errors.length > 20 && <li>… 仅展示前 20 条</li>}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </section>
  )
}