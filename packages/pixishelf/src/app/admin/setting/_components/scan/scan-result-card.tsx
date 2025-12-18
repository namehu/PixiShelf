'use client'

import React, { useRef, useEffect } from 'react'
import { useScanStore } from '@/store/scanStore'
import { SCard } from '@/components/shared/s-card'
import { Button } from '@/components/ui/button'
import { Terminal, Eraser, Bug, CheckCircle2, XCircle } from 'lucide-react'
import { ScanStats } from './scan-stats'
import { cn } from '@/lib/utils'

interface ScanResultCardProps {
  onCancel: () => void
  elapsed: number
  autoScroll: boolean
  setAutoScroll: (v: boolean) => void
}

export function ScanResultCard({ onCancel, elapsed, autoScroll, setAutoScroll }: ScanResultCardProps) {
  const { logs, result, isScanning, error, clearLogs } = useScanStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  if (!isScanning && !result && logs.length === 0 && !error) {
    return null
  }

  // 标题状态逻辑 (增加图标美化)
  const renderTitle = () => {
    if (isScanning) {
      return (
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
          </div>
          <span className="text-blue-600 font-medium">扫描进行中... ({formatTime(elapsed)})</span>
        </div>
      )
    }
    if (result) {
      return (
        <div className="flex items-center gap-2 text-green-600 font-medium">
          <CheckCircle2 className="h-5 w-5" /> 扫描任务完成
        </div>
      )
    }
    if (error) {
      return (
        <div className="flex items-center gap-2 text-red-600 font-medium">
          <XCircle className="h-5 w-5" /> 扫描任务中断
        </div>
      )
    }
    return <span>任务就绪</span>
  }

  return (
    <SCard
      title={renderTitle()}
      className="border-neutral-200 shadow-md"
      extra={
        <div className="flex items-center gap-2">
          {!isScanning && logs.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearLogs}
              className="text-neutral-500 h-8 hover:text-red-600 hover:bg-red-50"
            >
              <Eraser className="mr-1 h-3.5 w-3.5" /> 清空日志
            </Button>
          )}
          {isScanning && (
            <Button variant="destructive" size="sm" onClick={onCancel} className="shadow-sm">
              停止任务
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* 1. 错误横幅 (更醒目) */}
        {error && (
          <div className="flex items-start gap-3 bg-red-50 text-red-700 p-4 rounded-lg border border-red-100 shadow-sm animate-in slide-in-from-top-2">
            <Bug className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">发生错误</p>
              <p className="text-sm opacity-90">{error}</p>
            </div>
          </div>
        )}

        {/* 2. 统计数据 */}
        {result && <ScanStats result={result} />}

        {/* 3. 日志终端 (Mac Terminal 风格) */}
        <div className="flex flex-col rounded-xl overflow-hidden border border-neutral-200 shadow-sm ring-1 ring-black/5">
          {/* 终端头部 */}
          <div className="bg-neutral-900 px-4 py-2.5 flex items-center justify-between text-xs border-b border-white/10">
            <div className="flex items-center gap-3">
              {/* 模拟 Mac 窗口按钮 */}
              <div className="flex gap-1.5 opacity-80 group hover:opacity-100 transition-opacity">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
              </div>
              <div className="flex items-center gap-2 ml-2 text-neutral-400 font-mono">
                <Terminal className="h-3.5 w-3.5" />
                <span>scan-process.log — {logs.length} lines</span>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-neutral-400 hover:text-white transition-colors select-none text-[11px] font-medium tracking-wide">
              <div className="relative flex items-center">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="peer h-3 w-3 cursor-pointer appearance-none rounded-sm border border-neutral-600 bg-neutral-800 checked:bg-blue-500 checked:border-blue-500 transition-all"
                />
                <svg
                  className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100"
                  width="8"
                  height="8"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              AUTO-SCROLL
            </label>
          </div>

          {/* 终端内容 */}
          <div
            ref={scrollRef}
            className="h-[360px] bg-[#1e1e1e] overflow-y-auto p-2 sm:p-4 font-mono text-[11px] leading-relaxed space-y-1 scroll-smooth custom-scrollbar"
          >
            {logs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-neutral-600 space-y-3">
                <Terminal className="h-8 w-8 opacity-20" />
                <p className="italic font-sans">等待任务启动...</p>
              </div>
            ) : (
              logs.map((log, i) => (
                <div
                  key={i}
                  // 🔥 修复重点 1: items-start 防止高度拉伸
                  // 🔥 修复重点 2: 减小 gap，在手机上省空间
                  className="flex items-start gap-2 sm:gap-3 hover:bg-white/[0.03] px-1 py-1 rounded transition-colors group"
                >
                  {/* 时间戳：手机上稍微缩进一点 */}
                  <span className="text-neutral-500 shrink-0 select-none w-[50px] sm:w-[65px] group-hover:text-neutral-400 transition-colors pt-[1px]">
                    {log.timestamp}
                  </span>

                  {/* 类型标签 */}
                  <span
                    className={cn(
                      // 🔥 修复重点 3: h-fit 防止被拉伸，w-16 适配手机宽度
                      'shrink-0 font-bold w-16 sm:w-20 text-center select-none rounded-[3px] py-[1px] text-[10px] h-fit',
                      log.type === 'error' && 'text-red-400 bg-red-400/10',
                      log.type === 'complete' && 'text-emerald-400 bg-emerald-400/10',
                      log.type === 'progress' && 'text-blue-400 bg-blue-400/10',
                      log.type === 'connection' && 'text-purple-400 bg-purple-400/10',
                      (log.type === 'info' || !log.type) && 'text-neutral-400 bg-neutral-400/10'
                    )}
                  >
                    {log.type || 'INFO'}
                  </span>

                  {/* 消息内容：pt-[1px] 是为了微调让文字和左边的标签视觉中心对齐 */}
                  <span
                    className={cn(
                      'break-all min-w-0 pt-[1px]',
                      log.type === 'error' ? 'text-red-200' : 'text-neutral-300',
                      log.type === 'complete' && 'text-emerald-200'
                    )}
                  >
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </SCard>
  )
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}
