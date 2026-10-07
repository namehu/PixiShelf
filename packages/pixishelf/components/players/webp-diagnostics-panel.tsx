'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import type { DiagnosticMode, DiagnosticsReport, WebpPlayer } from '@pixishelf/webp-player'
import { Button } from '@/components/ui/button'
import { useWebpPlayerStore } from '@/store/use-webp-player-store'

export interface WebpDiagnosticResult {
  outcome: 'completed' | 'error' | 'manual' | 'hidden' | 'timeout' | 'media-change-or-close'
  report: DiagnosticsReport | null
  setupMs: number | null
  testElapsedMs: number
}
interface Props {
  src: string
  size?: number | null
  canvas: RefObject<HTMLCanvasElement | null>
  results: WebpDiagnosticResult[]
  onResult: (result: WebpDiagnosticResult) => void
  onStart: () => void
  onRunning: (running: boolean) => void
  onVisible: (visible: boolean) => void
}
const modes: { mode: DiagnosticMode; label: string }[] = [
  { mode: 'legacy', label: '旧调度' },
  { mode: 'timeline', label: '新调度' },
  { mode: 'no-draw', label: '新调度 · 不绘制' }
]

/** Mounted only for the current local WebP when the diagnostic URL flag is set. */
export function WebpDiagnosticsPanel(props: Props) {
  const latest = useRef(props)
  latest.current = props
  const attempt = useRef(0)
  const player = useRef<WebpPlayer | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const runStarted = useRef(0)
  const setupMs = useRef<number | null>(null)
  const runningRef = useRef(false)
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [exportText, setExportText] = useState('')
  const [message, setMessage] = useState('')
  const finishRef = useRef<(outcome: WebpDiagnosticResult['outcome']) => void>(() => {})
  finishRef.current = (outcome) => {
    if (!runningRef.current) return
    runningRef.current = false
    attempt.current++
    clearTimeout(timer.current)
    const report = player.current?.getDiagnostics() ?? null
    player.current?.destroy()
    player.current = null
    latest.current.onResult({
      outcome,
      report,
      setupMs: setupMs.current,
      testElapsedMs: performance.now() - runStarted.current
    })
    latest.current.onRunning(false)
    latest.current.onVisible(false)
    setRunning(false)
    setMessage(outcome === 'completed' ? '本轮测试完成' : `测试已停止：${outcome}`)
  }
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) finishRef.current('hidden')
    }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      finishRef.current('media-change-or-close')
    }
  }, [props.src])

  const start = async (mode: DiagnosticMode) => {
    if (runningRef.current || document.hidden) return
    runStarted.current = performance.now()
    setupMs.current = null
    latest.current.onStart()
    latest.current.onRunning(true)
    latest.current.onVisible(false)
    runningRef.current = true
    setRunning(true)
    setMessage('测试进行中，最长 120 秒')
    const token = ++attempt.current
    timer.current = setTimeout(() => finishRef.current('timeout'), 120_000)
    try {
      const [manifest, { WebpPlayer }] = await Promise.all([
        useWebpPlayerStore.getState().loadManifest(),
        import('@pixishelf/webp-player')
      ])
      if (token !== attempt.current) return
      if (!latest.current.canvas.current) throw new Error('Missing diagnostic canvas')
      const base = `/webp-player/${manifest.version}`
      const instance = new WebpPlayer(latest.current.canvas.current, {
        workerUrl: `${base}/worker.mjs`,
        decoderUrl: `${base}/decoder.mjs`,
        diagnostics: { mode, resourceVersion: manifest.version }
      })
      player.current = instance
      setupMs.current = performance.now() - runStarted.current
      instance.subscribe((event) => {
        if (token !== attempt.current) return
        if (event.type === 'first-frame' && mode !== 'no-draw') latest.current.onVisible(true)
        if (event.type === 'ended') finishRef.current('completed')
        if (event.type === 'error') finishRef.current('error')
      })
      const ready = instance.load({
        url: props.src,
        resourceKey: `diagnostic-${token}`,
        loop: false,
        size: props.size ?? undefined
      })
      instance.play()
      await ready.catch(() => {})
    } catch {
      if (token === attempt.current) finishRef.current('error')
    }
  }
  const json = () => JSON.stringify({ version: 1, results: latest.current.results }, null, 2)
  const copy = async () => {
    const text = json()
    try {
      await navigator.clipboard.writeText(text)
      setMessage('报告已复制')
    } catch {
      setExportText(text)
      setMessage('无法自动复制，请从下方手动复制')
    }
  }
  const download = () => {
    let url: string | undefined
    try {
      const text = json()
      url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'webp-diagnostics.json'
      link.click()
      setMessage('已请求下载报告')
    } catch {
      setExportText(json())
      setMessage('无法下载，请从下方手动复制')
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000)
    }
  }
  return (
    <div
      className="pointer-events-auto absolute bottom-full left-0 mb-16 max-h-[60dvh] max-w-full overflow-auto rounded-lg border bg-background p-3 text-foreground shadow-sm"
      data-auto-browse-controls
      onPointerDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
    >
      <Button variant="outline" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        WebP 性能诊断
      </Button>
      {expanded && (
        <div className="mt-2 flex max-w-sm flex-col gap-2">
          <p className="text-sm">单轮测试会停止当前播放和自动浏览。报告仅保留在本页，最近 10 次。</p>
          <div className="flex flex-wrap gap-2">
            {modes.map(({ mode, label }) => (
              <Button key={mode} variant="outline" disabled={running} onClick={() => void start(mode)}>
                {label}
              </Button>
            ))}
            {running && (
              <Button variant="outline" onClick={() => finishRef.current('manual')}>
                停止测试
              </Button>
            )}
          </div>
          <p role="status" className="text-sm">
            {message}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!props.results.length} onClick={() => void copy()}>
              复制报告（{props.results.length}）
            </Button>
            <Button variant="outline" disabled={!props.results.length} onClick={download}>
              下载 JSON
            </Button>
          </div>
          {exportText && (
            <textarea
              aria-label="手动复制诊断报告"
              className="min-h-32 w-full rounded border p-2 text-xs"
              readOnly
              value={exportText}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
        </div>
      )}
    </div>
  )
}
