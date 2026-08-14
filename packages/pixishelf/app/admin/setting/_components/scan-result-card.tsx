'use client'

import React from 'react'
import { useScanStore } from '@/store/scan-store'
import { SCard } from '@/components/shared/s-card'
import { Button } from '@/components/ui/button'
import { Bug, CheckCircle2, XCircle } from 'lucide-react'
import { ScanStats } from './scan-stats'
import { LogViewer } from '@/components/shared/log-viewer'
import { useLogger } from '@/hooks/use-logger'
import { formatTime } from '@/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

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
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
            <span className="relative inline-flex size-3 rounded-full bg-primary" />
          </div>
          <span className="font-medium text-primary">扫描进行中…（{formatTime(elapsed)}）</span>
        </div>
      )
    }
    if (result) {
      return (
        <div className="flex items-center gap-2 font-medium text-success">
          <CheckCircle2 className="size-5" aria-hidden="true" /> 扫描任务完成
        </div>
      )
    }
    if (error) {
      return (
        <div className="flex items-center gap-2 font-medium text-destructive">
          <XCircle className="size-5" aria-hidden="true" /> 扫描任务中断
        </div>
      )
    }
    return <span>任务就绪</span>
  }

  return (
    <SCard
      title={renderTitle()}
      className="border-border"
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
      <div className="flex flex-col gap-6">
        {/* 1. 错误横幅 (更醒目) */}
        {error && (
          <Alert variant="destructive">
            <Bug aria-hidden="true" />
            <AlertTitle>发生错误</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 2. 统计数据 */}
        {result && <ScanStats result={result} />}

        {/* 3. 日志终端 (使用新组件) */}
        <LogViewer logs={logs} onClear={logs.length > 0 ? clearLogs : undefined} height={360} loading={isScanning} />
      </div>
    </SCard>
  )
}
