import React, { useState, memo, useRef, useEffect } from 'react'
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import { LogEntry, LogModule } from '@/lib/db'
import { cn } from '@/lib/utils'
import { Terminal, Eraser, Search, ArrowDown, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LogViewerProps {
  logs: LogEntry[]
  onClear?: () => void
  className?: string
  height?: string | number
  loading?: boolean
}

// 日志项组件 - 使用 memo 优化渲染
const LogItem = memo(({ index, log }: { index: number; log: LogEntry }) => {
  return (
    <div className="flex items-start gap-2 sm:gap-3 hover:bg-white/[0.03] px-2 py-1 rounded transition-colors group text-[11px] font-mono leading-relaxed">
      {/* 时间戳 */}
      <span className="text-neutral-500 shrink-0 select-none w-[65px] group-hover:text-neutral-400 transition-colors pt-[1px]">
        {new Date(log.timestamp).toLocaleTimeString()}
      </span>

      {/* 类型标签 */}
      <span
        className={cn(
          'shrink-0 font-bold w-16 sm:w-20 text-center select-none rounded-[3px] py-[1px] text-[10px] h-fit',
          log.level === 'error' && 'text-red-400 bg-red-400/10',
          log.level === 'complete' && 'text-emerald-400 bg-emerald-400/10',
          log.level === 'success' && 'text-green-400 bg-green-400/10',
          log.level === 'progress' && 'text-blue-400 bg-blue-400/10',
          log.level === 'connection' && 'text-purple-400 bg-purple-400/10',
          log.level === 'warn' && 'text-orange-400 bg-orange-400/10',
          (log.level === 'info' || !log.level) && 'text-neutral-400 bg-neutral-400/10'
        )}
      >
        {log.level?.toUpperCase() || 'INFO'}
      </span>

      {/* 消息内容 */}
      <span
        className={cn(
          'break-all min-w-0 pt-[1px] whitespace-pre-wrap',
          log.level === 'error' ? 'text-red-200' : 'text-neutral-300',
          (log.level === 'complete' || log.level === 'success') && 'text-emerald-200'
        )}
      >
        {log.message}
      </span>
    </div>
  )
})

LogItem.displayName = 'LogItem'

export function LogViewer({ logs, onClear, className, height = 400, loading }: LogViewerProps) {
  const [autoScroll, setAutoScroll] = useState(true)
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const [filter, setFilter] = useState('')

  // 过滤日志
  const filteredLogs = React.useMemo(() => {
    if (!filter) return logs
    const lowerFilter = filter.toLowerCase()
    return logs.filter(
      (log) => log.message.toLowerCase().includes(lowerFilter) || log.level.toLowerCase().includes(lowerFilter)
    )
  }, [logs, filter])

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl overflow-hidden border border-neutral-200 shadow-sm ring-1 ring-black/5 bg-[#1e1e1e]',
        className
      )}
    >
      {/* 终端头部 */}
      <div className="bg-neutral-900 px-4 py-2.5 flex items-center justify-between text-xs border-b border-white/10 shrink-0">
        <div className="flex items-center gap-4 flex-1">
          {/* 模拟 Mac 窗口按钮 */}
          <div className="flex gap-1.5 opacity-80 group hover:opacity-100 transition-opacity">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
          </div>

          <div className="flex items-center gap-2 text-neutral-400 font-mono">
            <Terminal className="h-3.5 w-3.5" />
            <span>Console — {filteredLogs.length} events</span>
          </div>

          {/* 搜索框 */}
          <div className="relative group ml-2 flex-1 max-w-[200px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-neutral-500 group-focus-within:text-neutral-300 transition-colors" />
            <input
              type="text"
              placeholder="Filter logs..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full bg-neutral-800/50 border border-neutral-700/50 rounded text-[11px] py-1 pl-7 pr-2 text-neutral-300 placeholder:text-neutral-600 focus:outline-none focus:bg-neutral-800 focus:border-neutral-600 transition-all"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {onClear && (
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 text-neutral-500 hover:text-red-400 transition-colors text-[11px]"
              title="Clear Console"
            >
              <Eraser className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}

          <div className="w-[1px] h-3 bg-white/10 mx-1" />

          <label className="flex items-center gap-2 cursor-pointer text-neutral-400 hover:text-white transition-colors select-none text-[11px] font-medium tracking-wide">
            <div className="relative flex items-center">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="peer h-3 w-3 cursor-pointer appearance-none rounded-sm border border-neutral-600 bg-neutral-800 checked:bg-blue-500 checked:border-blue-500 transition-all"
              />
              <ArrowDown className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white opacity-0 peer-checked:opacity-100 w-2 h-2" />
            </div>
            AUTO-SCROLL
          </label>
        </div>
      </div>

      {/* 终端内容区 */}
      <div className="relative bg-[#1e1e1e]" style={{ height }}>
        {filteredLogs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-neutral-600 space-y-3">
            <Terminal className="h-8 w-8 opacity-20" />
            <p className="italic font-sans text-xs">
              {filter ? 'No logs match your filter' : loading ? 'Waiting for logs...' : 'No logs available'}
            </p>
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={filteredLogs}
            totalCount={filteredLogs.length}
            atBottomStateChange={(atBottom) => {
              // 如果用户手动向上滚动，自动关闭 autoScroll
              if (!atBottom) {
                setAutoScroll(false)
              }
            }}
            followOutput={(isAtBottom) => {
              // 如果开启了 autoScroll，强制滚动到底部
              return autoScroll ? 'smooth' : false
            }}
            itemContent={(index, log) => <LogItem index={index} log={log} />}
            className="custom-scrollbar"
            style={{ height: '100%' }}
          />
        )}
      </div>
    </div>
  )
}
