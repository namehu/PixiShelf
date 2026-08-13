'use client'

import { Badge } from '@/components/ui/badge'

export type ScanRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
export type ScanRunItemStatus = 'SUCCESS' | 'SKIPPED' | 'FAILED'

export function StatusBadge({ status }: { status: ScanRunStatus }) {
  const className = {
    RUNNING: 'border-blue-200 bg-blue-50 text-blue-700',
    COMPLETED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    FAILED: 'border-red-200 bg-red-50 text-red-700',
    CANCELLED: 'border-neutral-200 bg-neutral-50 text-neutral-600'
  }[status]

  return (
    <Badge variant="outline" className={className}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {formatStatus(status)}
    </Badge>
  )
}

export function ItemStatusBadge({ status }: { status: ScanRunItemStatus }) {
  const className = {
    SUCCESS: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    SKIPPED: 'border-neutral-200 bg-neutral-50 text-neutral-600',
    FAILED: 'border-red-200 bg-red-50 text-red-700'
  }[status]

  return (
    <Badge variant="outline" className={className}>
      {formatItemStatus(status)}
    </Badge>
  )
}

export function formatStatus(status: ScanRunStatus) {
  return {
    RUNNING: '运行中',
    COMPLETED: '完成',
    FAILED: '失败',
    CANCELLED: '已取消'
  }[status]
}

export function formatItemStatus(status: ScanRunItemStatus) {
  return {
    SUCCESS: '成功',
    SKIPPED: '跳过',
    FAILED: '失败'
  }[status]
}

export function formatMode(mode: string) {
  return (
    {
      FULL: '强制全量',
      INCREMENTAL: '增量扫描',
      CLIENT_LIST: '客户端列表',
      RESCAN: '作品重扫',
      LOCAL_RESCAN: '本地重扫',
      LOCAL_DIRECTORY_IMPORT: '本地目录导入',
      LOCAL_CREATE: '本地创建',
      BATCH_CREATE: '批量创建',
      BATCH_REGISTER_IMAGES: '批量注册图片'
    }[mode] ?? mode
  )
}

export function formatType(type: string) {
  return (
    {
      PIXIV: 'Pixiv',
      LOCAL_IMPORT: '本地导入',
      LOCAL_CREATE: '本地创建',
      BATCH_IMPORT: '批量导入'
    }[type] ?? type
  )
}

export function formatAction(action: string) {
  return (
    {
      CREATE: '新增',
      UPDATE: '更新',
      SKIP_EXISTING: '已存在',
      SKIP_INVALID_METADATA: '无效 metadata',
      SKIP_NO_MEDIA: '无媒体',
      FAILED_PARSE: '解析失败',
      FAILED_COLLECT: '收集失败',
      FAILED_WRITE: '写入失败'
    }[action] ?? action
  )
}

export function formatDate(value: Date | string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatFullDate(value: Date | string) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function formatDuration(value: number | null) {
  if (!value) return '-'
  if (value < 1000) return `${value}ms`
  return `${Math.round(value / 1000)}s`
}
