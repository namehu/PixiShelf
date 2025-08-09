import React from 'react'
import { useMutation } from '@tanstack/react-query'

// 命名规范：组件用 PascalCase，文件名 Settings.tsx（PascalCase）

type ScanResult = {
  scannedDirectories: number
  foundImages: number
  newArtworks: number
  newImages: number
  errors: string[]
}

function useManualScan() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/scan', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${import.meta.env.VITE_API_KEY ?? ''}` },
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
  const scan = useManualScan()
  const [elapsed, setElapsed] = React.useState(0)

  React.useEffect(() => {
    let timer: any
    if (scan.isPending) {
      setElapsed(0)
      const started = Date.now()
      timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    }
    return () => timer && clearInterval(timer)
  }, [scan.isPending])

  const secondsToText = (s: number) => {
    const mm = String(Math.floor(s / 60)).padStart(2, '0')
    const ss = String(s % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  const result = scan.data?.result

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">设置</h2>

      <div className="rounded-lg border bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-base font-medium">手动扫描</div>
            <div className="text-sm text-gray-500">扫描 SCAN_PATH 目录下的图片并同步到库中。扫描期间请保持页面打开。</div>
          </div>
          <button
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
            className="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
          >{scan.isPending ? '扫描中…' : '开始扫描'}</button>
        </div>

        {scan.isIdle && !scan.data && !scan.isError && (
          <div className="text-sm text-gray-600">状态：未开始</div>
        )}

        {scan.isPending && (
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