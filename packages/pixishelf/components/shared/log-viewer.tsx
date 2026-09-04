'use client'

import { memo, useId, useMemo, useRef, useState } from 'react'
import { ArrowDown, Copy, Eraser, Search, Terminal } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { toast } from 'sonner'
import type { LogEntry } from '@/lib/db'
import { cn } from '@/lib/utils'
import { confirm } from '@/components/shared/global-confirm'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

interface LogViewerProps {
  logs: LogEntry[]
  onClear?: () => void
  className?: string
  height?: string | number
  loading?: boolean
}

function formatLogEntry(log: LogEntry) {
  const time = new Date(log.timestamp).toLocaleTimeString()
  const level = log.level?.toUpperCase() || 'INFO'

  return `${time} [${level}] ${log.message}`
}

const LogItem = memo(({ log }: { log: LogEntry }) => (
  <div className="group flex items-start gap-2 rounded px-2 py-1 font-mono text-[11px] leading-relaxed transition-colors hover:bg-white/[0.03] sm:gap-3">
    <span className="w-[65px] shrink-0 pt-px text-neutral-500 transition-colors group-hover:text-neutral-400">
      {new Date(log.timestamp).toLocaleTimeString()}
    </span>
    <span
      className={cn(
        'h-fit w-16 shrink-0 rounded-sm py-px text-center text-[10px] font-bold sm:w-20',
        log.level === 'error' && 'bg-red-400/10 text-red-400',
        log.level === 'complete' && 'bg-emerald-400/10 text-emerald-400',
        log.level === 'success' && 'bg-green-400/10 text-green-400',
        log.level === 'progress' && 'bg-blue-400/10 text-blue-400',
        log.level === 'connection' && 'bg-purple-400/10 text-purple-400',
        log.level === 'warn' && 'bg-orange-400/10 text-orange-400',
        (log.level === 'info' || !log.level) && 'bg-neutral-400/10 text-neutral-400'
      )}
    >
      {log.level?.toUpperCase() || 'INFO'}
    </span>
    <PrivacySensitiveText
      className={cn(
        'min-w-0 break-all whitespace-pre-wrap pt-px',
        log.level === 'error' ? 'text-red-200' : 'text-neutral-300',
        (log.level === 'complete' || log.level === 'success') && 'text-emerald-200'
      )}
    >
      {log.message}
    </PrivacySensitiveText>
  </div>
))

LogItem.displayName = 'LogItem'

export function LogViewer({ logs, onClear, className, height = 400, loading }: LogViewerProps) {
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const autoScrollId = useId()

  const filteredLogs = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase()
    if (!normalizedFilter) return logs

    return logs.filter(
      (log) =>
        log.message.toLowerCase().includes(normalizedFilter) ||
        (log.level || 'info').toLowerCase().includes(normalizedFilter)
    )
  }, [logs, filter])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(filteredLogs.map(formatLogEntry).join('\n'))
      toast.success(`已复制 ${filteredLogs.length} 条日志`)
    } catch {
      toast.error('复制失败，请直接框选日志内容复制')
    }
  }

  const handleClear = () => {
    if (!onClear) return

    confirm({
      title: '清空运行日志？',
      description: '全部运行日志将被永久删除，此操作无法撤销。',
      confirmText: '清空日志',
      variant: 'destructive',
      onConfirm: onClear
    })
  }

  return (
    <section
      aria-label="运行日志"
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-neutral-800 bg-[#1e1e1e] shadow-sm',
        className
      )}
    >
      <header className="flex shrink-0 flex-col gap-2 border-b border-white/10 bg-neutral-900 px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <div className="flex shrink-0 items-center gap-2 font-mono text-neutral-400">
            <Terminal className="size-3.5" aria-hidden="true" />
            <span className="whitespace-nowrap">运行日志</span>
            <span aria-live="polite" className="text-neutral-500">
              {filteredLogs.length} 条
            </span>
          </div>

          <InputGroup className="h-8 max-w-64 border-neutral-700 bg-neutral-800/70 shadow-none focus-within:border-neutral-500">
            <InputGroupAddon>
              <Search className="text-neutral-500" aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              name="log-filter"
              autoComplete="off"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="筛选日志…"
              aria-label="筛选日志"
              className="h-8 text-xs text-neutral-200 placeholder:text-neutral-500"
            />
          </InputGroup>
        </div>

        <div className="flex items-center justify-between gap-1 sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            disabled={filteredLogs.length === 0}
            className="text-neutral-400 hover:bg-white/10 hover:text-white"
          >
            <Copy data-icon="inline-start" aria-hidden="true" />
            复制{filter ? '筛选结果' : '日志'}
          </Button>

          {onClear && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="text-neutral-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <Eraser data-icon="inline-start" aria-hidden="true" />
              清空
            </Button>
          )}

          <div className="mx-1 hidden h-4 w-px bg-white/10 sm:block" aria-hidden="true" />

          <div className="flex min-h-9 items-center gap-2 px-2 text-neutral-400 hover:text-white">
            <Checkbox
              id={autoScrollId}
              checked={autoScroll}
              onCheckedChange={(checked) => setAutoScroll(checked === true)}
              className="border-neutral-600 bg-neutral-800 data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500"
            />
            <Label htmlFor={autoScrollId} className="cursor-pointer gap-1.5 whitespace-nowrap text-[11px]">
              <ArrowDown className="size-3" aria-hidden="true" />
              自动滚动
            </Label>
          </div>
        </div>
      </header>

      <div className="relative bg-[#1e1e1e]" style={{ height }}>
        {filteredLogs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
            <Terminal className="size-8 opacity-30" aria-hidden="true" />
            <p className="text-xs">{filter ? '没有符合筛选条件的日志' : loading ? '正在等待日志…' : '暂无日志'}</p>
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={filteredLogs}
            totalCount={filteredLogs.length}
            atBottomStateChange={(atBottom) => {
              if (!atBottom) setAutoScroll(false)
            }}
            followOutput={() => (autoScroll ? 'smooth' : false)}
            itemContent={(_index, log) => <LogItem log={log} />}
            className="custom-scrollbar"
            style={{ height: '100%' }}
          />
        )}
      </div>
    </section>
  )
}
