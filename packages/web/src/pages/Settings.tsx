import React from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

// 命名规范：组件用 PascalCase，文件名 Settings.tsx（PascalCase）

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

function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/v1/health', {
        headers: { 'Authorization': `Bearer ${import.meta.env.VITE_API_KEY ?? ''}` },
      })
      if (!res.ok) throw new Error('health failed')
      return res.json() as Promise<Health>
    },
  })
}

function useManualScan() {
  return useMutation({
    mutationFn: async (force?: boolean) => {
      const res = await fetch('/api/v1/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_API_KEY ?? ''}`
        },
        body: JSON.stringify({ force: !!force })
      })
      const text = await res.text()
      if (!res.ok) {
        try {
          const j = JSON.parse(text)
          throw new Error(j.message || '扫描失败')
        } catch {
          throw new Error(text || '扫描失败')
        }
      }
      return JSON.parse(text) as { success: boolean; result: ScanResult }
    },
  })
}

export default function Settings() {
  const { data: health } = useHealth()
  const scan = useManualScan()
  const [elapsed, setElapsed] = React.useState(0)
  const [progress, setProgress] = React.useState<ScanProgress | null>(null)
  const [streaming, setStreaming] = React.useState(false)
  const [streamResult, setStreamResult] = React.useState<ScanResult | null>(null)
  const [streamError, setStreamError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let timer: any
    if (scan.isPending || streaming) {
      setElapsed(0)
      const started = Date.now()
      timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    }
    return () => timer && clearInterval(timer)
  }, [scan.isPending, streaming])

  const secondsToText = (s: number) => {
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  const result = scan.data?.result

  const startStream = React.useCallback((force?: boolean) => {
    setStreaming(true)
    setProgress(null)
    setStreamResult(null)
    setStreamError(null)

    const token = (import.meta.env.VITE_API_KEY ?? '') as string
    const qs = new URLSearchParams()
    if (force) qs.set('force', 'true')
    if (token) qs.set('apiKey', token)
    const url = `/api/v1/scan/stream${qs.toString() ? `?${qs.toString()}` : ''}`
    const es = new EventSource(url, { withCredentials: false } as any)

    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as { type: string; data: any }
        if (payload.type === 'progress') {
          setProgress(payload.data as ScanProgress)
        } else if (payload.type === 'complete') {
          setStreamResult(payload.data.result as ScanResult)
          setStreaming(false)
          es.close()
        } else if (payload.type === 'error') {
          setStreamError(payload.data.error || '未知错误')
          setStreaming(false)
          es.close()
        }
      } catch (e) {
        // ignore parse error
      }
    }

    es.onerror = () => {
      setStreamError('连接中断或服务器错误')
      setStreaming(false)
      es.close()
    }
  }, [])

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">设置</h2>

      <div className="rounded-lg border bg-white p-5">
        <div className="mb-2 text-sm text-gray-600">
          扫描路径：
          <span className="font-mono">{health?.scanPath || '未配置（请在 API 的 .env 中设置 SCAN_PATH）'}</span>
        </div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-medium">手动扫描</div>
            <div className="text-sm text-gray-500">扫描 SCAN_PATH 目录下的图片并同步到库中。扫描期间请保持页面打开。</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => scan.mutate(false)}
              disabled={scan.isPending || streaming}
              className="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
            >{scan.isPending ? '扫描中…' : '开始扫描'}</button>
            <button
              onClick={() => scan.mutate(true)}
              disabled={scan.isPending || streaming}
              className="rounded border border-brand-600 px-3 py-2 text-brand-700 hover:bg-brand-50 disabled:opacity-50"
              title="强制全量更新：清空现有数据后重建"
            >强制全量</button>
          </div>
        </div>

        {(scan.isIdle && !scan.data && !scan.isError && !streaming && !streamResult) && (
          <div className="text-sm text-gray-600">状态：未开始</div>
        )}

        {(scan.isPending) && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
              <div className="h-2 w-1/3 animate-[progress_1.2s_ease-in-out_infinite] rounded bg-brand-500" style={{ animationName: 'progress' }} />
            </div>
            <div className="text-sm text-gray-600">扫描进行中… 已用时 {secondsToText(elapsed)}</div>
          </div>
        )}

        {scan.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            扫描失败：{(scan.error as Error)?.message || '未知错误'}
          </div>
        )}

        {result && (
          <div className="mt-3 space-y-2 text-sm">
            <div className="text-green-700">扫描完成</div>
            <ul className="grid grid-cols-2 gap-2">
              <li className="rounded border bg-gray-50 p-2">扫描目录：<span className="font-medium">{result.scannedDirectories}</span></li>
              <li className="rounded border bg-gray-50 p-2">发现图片：<span className="font-medium">{result.foundImages}</span></li>
              <li className="rounded border bg-gray-50 p-2">新增作品：<span className="font-medium">{result.newArtworks}</span></li>
              <li className="rounded border bg-gray-50 p-2">新增图片：<span className="font-medium">{result.newImages}</span></li>
              {typeof result.removedArtworks === 'number' && <li className="rounded border bg-gray-50 p-2">删除空作品：<span className="font-medium">{result.removedArtworks}</span></li>}
            </ul>
            {result.errors?.length > 0 && (
              <details className="rounded border bg-yellow-50 p-3">
                <summary className="cursor-pointer text-yellow-800">错误 {result.errors.length} 条（展开查看）</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-yellow-900">
                  {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
                  {result.errors.length > 20 && <li>… 仅展示前 20 条</li>}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-white p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-medium">实时进度（SSE）</div>
            <div className="text-sm text-gray-500">使用 Server-Sent Events 实时显示扫描进度。适合长时间执行任务。</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => startStream(false)}
              disabled={scan.isPending || streaming}
              className="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
            >{streaming ? '进行中…' : '开始（SSE）'}</button>
            <button
              onClick={() => startStream(true)}
              disabled={scan.isPending || streaming}
              className="rounded border border-brand-600 px-3 py-2 text-brand-700 hover:bg-brand-50 disabled:opacity-50"
              title="强制全量更新：清空现有数据后重建（SSE）"
            >强制全量（SSE）</button>
          </div>
        </div>

        {streaming && (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
              <div className="h-2 w-1/3 animate-[progress_1.2s_ease-in-out_infinite] rounded bg-brand-500" style={{ animationName: 'progress' }} />
            </div>
            <div className="text-sm text-gray-600">{progress?.message || '准备中…'} 已用时 {secondsToText(elapsed)}</div>
          </div>
        )}

        {streamError && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            实时通道错误：{streamError}
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