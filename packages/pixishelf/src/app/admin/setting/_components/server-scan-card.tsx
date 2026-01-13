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
  /** 触发增量扫描 */
  onScanIncremental: () => void
  /** 触发全量扫描 */
  onScanForce: () => void
  className?: string
}

export function ServerScanCard({
  scanPathData,
  isUpdatingPath,
  isScanning,
  healthStatus,
  onUpdatePath,
  onScanIncremental,
  onScanForce,
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
            <FolderOpen className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
            <Input
              value={tempPath}
              onChange={(e) => setTempPath(e.target.value)}
              placeholder="请输入绝对路径..."
              className="pl-9 font-mono text-sm"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            />
          </div>
          <Button size="sm" onClick={handleSave} disabled={isUpdatingPath || !tempPath.trim()}>
            <Save className="mr-1 h-3.5 w-3.5" /> 保存
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )
    }

    return (
      <div className="flex items-center justify-between rounded-lg border bg-neutral-50/50 p-3">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-600">
            <FolderOpen size={16} />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-neutral-500">当前扫描目录</span>
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
          <span className="text-xs text-neutral-400">后端状态</span>
          <Badge
            variant={healthStatus === 'ok' ? 'outline' : 'destructive'}
            className={cn('gap-1', healthStatus === 'ok' && 'border-green-200 text-green-700 bg-green-50')}
          >
            <Activity size={10} />
            {healthStatus || 'Checking...'}
          </Badge>
        </div>
      }
      // 把主要的扫描动作放在 Footer，符合"配置完 -> 执行"的逻辑流
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <span className="text-xs text-neutral-400 mr-auto">
            {isScanning ? '任务正在后台执行中...' : '选择扫描模式以开始'}
          </span>

          <Button variant="secondary" onClick={onScanForce} disabled={isScanning || !scanPathData}>
            强制全量重扫
          </Button>
          <Button onClick={onScanIncremental} disabled={isScanning || !scanPathData}>
            {isScanning ? '扫描中...' : '开始增量扫描'}
          </Button>
        </div>
      }
    >
      {/* 内容区域只放配置 */}
      <div className="py-1">{renderPathConfig()}</div>
    </SCard>
  )
}
