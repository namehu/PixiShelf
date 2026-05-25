'use client'

import React from 'react'
import { useScanStore } from '@/store/scanStore'
import { SCard } from '@/components/shared/s-card'
import { Button } from '@/components/ui/button'
import { Bug, CheckCircle2, XCircle } from 'lucide-react'
import { ScanStats } from './scan-stats'
import { LogViewer } from '@/components/shared/log-viewer'
import { useLogger } from '@/hooks/use-logger'
import { formatTime } from '@/lib/utils'

interface ScanResultCardProps {
  onCancel: () => void
  elapsed: number
}

export function ScanResultCard({ onCancel, elapsed }: ScanResultCardProps) {
  // 从 store 获取状态，但不获取日志
  const { result, isScanning, error } = useScanStore()

  // 使用 useLogger 获取日志数据
  const { logs, clearLogs } = useLogger('scan-server')

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

        {/* 3. 日志终端 (使用新组件) */}
        <LogViewer logs={logs} onClear={logs.length > 0 ? clearLogs : undefined} height={360} loading={isScanning} />
      </div>
    </SCard>
  )
}
