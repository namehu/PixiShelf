'use client'

import React, { useState } from 'react'
import { SCard } from '@/components/shared/s-card' // 使用封装好的 Shared Card
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { FolderOpen, Save, X, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ServerScanCardProps {
  /** 扫描路径数据 */
  scanPathData: string | undefined
  /** 路径更新状态 */
  isUpdatingPath: boolean
  /** 扫描进行中状态 */
  isScanning: boolean
  /** 后端健康状态 */
  healthStatus?: string
  /** 更新路径回调 */
  onUpdatePath: (path: string) => void
  /** 扫描目录中尚未入库的新作品 */
  onScanNewArtworks: () => void
  className?: string
}

export function ServerScanCard({
  scanPathData,
  isUpdatingPath,
  isScanning,
  healthStatus,
  onUpdatePath,
  onScanNewArtworks,
  className
}: ServerScanCardProps) {
  // 内部管理编辑状态，不再污染父组件
  const [editing, setEditing] = useState(false)
  const [tempPath, setTempPath] = useState('')

  const handleStartEdit = () => {
    setTempPath(scanPathData || '')
    setEditing(true)
  }

  const handleSave = () => {
    if (!tempPath.trim()) return
    onUpdatePath(tempPath.trim())
    setEditing(false)
  }

  const handleCancel = () => {
    setEditing(false)
    setTempPath('')
  }

  // 渲染路径显示/编辑区
  const renderPathConfig = () => {
    if (editing) {
      return (
        <div className="flex items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
          <div className="relative flex-1">
            <FolderOpen className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
            <Input
              name="server-scan-path"
              aria-label="服务端扫描目录"
              autoComplete="off"
              spellCheck={false}
              value={tempPath}
              onChange={(e) => setTempPath(e.target.value)}
              placeholder="请输入绝对路径…"
              className="pl-9 font-mono text-sm"
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>
          <Button size="sm" onClick={handleSave} disabled={isUpdatingPath || !tempPath.trim()}>
            <Save data-icon="inline-start" aria-hidden="true" />
            保存
          </Button>
          <Button size="icon" variant="ghost" onClick={handleCancel} aria-label="取消编辑扫描目录">
            <X aria-hidden="true" />
          </Button>
        </div>
      )
    }

    return (
      <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-3">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
            <FolderOpen className="size-4" aria-hidden="true" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-muted-foreground">当前扫描目录</span>
            <span className="font-mono text-sm font-medium truncate" title={scanPathData}>
              {scanPathData || '未配置'}
            </span>
          </div>
        </div>
        <Button variant="link" size="sm" onClick={handleStartEdit} disabled={isScanning}>
          修改
        </Button>
      </div>
    )
  }

  return (
    <SCard
      className={cn(className)}
      title="服务端扫描管理"
      description="配置服务器文件路径并执行扫描任务"
      // 把健康状态放在 Header 右上角
      extra={
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">后端状态</span>
          <Badge variant={healthStatus === 'ok' ? 'success' : 'destructive'}>
            <Activity data-icon="inline-start" aria-hidden="true" />
            {healthStatus || '检查中…'}
          </Badge>
        </div>
      }
      // 把主要的扫描动作放在 Footer，符合"配置完 -> 执行"的逻辑流
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <span className="mr-auto text-xs text-muted-foreground">
            {isScanning ? '任务正在后台执行中…' : '扫描目录并导入尚未入库的作品'}
          </span>

          <Button onClick={onScanNewArtworks} disabled={isScanning || !scanPathData}>
            {isScanning ? '扫描中…' : '扫描新作品'}
          </Button>
        </div>
      }
    >
      {/* 内容区域只放配置 */}
      <div className="py-1">{renderPathConfig()}</div>
    </SCard>
  )
}
