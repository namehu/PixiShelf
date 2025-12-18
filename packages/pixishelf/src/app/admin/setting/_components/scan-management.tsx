'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson } from '@/lib/api'
import { HealthResponse, ScanPathResponse, LogEntry } from '@/types'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useSseScan } from '../_hooks/use-sse-scan'
import { confirm } from '@/components/shared/global-confirm' // 直接引入函数
import { SCard } from '@/components/shared/s-card'

function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiJson<HealthResponse>('/api/health')
  })
}

// Hook: 扫描路径管理
function useScanPath() {
  const queryClient = useQueryClient()
  return {
    query: useQuery({
      queryKey: ['scanPath'],
      queryFn: async () => apiJson<ScanPathResponse>('/api/settings/scan-path')
    }),
    update: useMutation({
      mutationFn: async (scanPath: string) =>
        apiJson('/api/settings/scan-path', {
          method: 'PUT',
          body: JSON.stringify({ scanPath })
        }),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['scanPath'] })
        queryClient.invalidateQueries({ queryKey: ['health'] })
      }
    })
  }
}

// Hook: 取消扫描
function useCancelScan() {
  return useMutation({
    mutationFn: async () =>
      apiJson<{ success: boolean; cancelled: boolean }>('/api/scan/cancel', {
        method: 'POST'
      })
  })
}

// 工具函数：秒数转时间文本
function secondsToText(s: number) {
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/**
 * 扫描日志查看器（可复用组件）
 * 从主组件中分离出来，使其更整洁
 */
function ScanLogViewer({
  logs,
  autoScroll,
  showDetailedLogs,
  onClearLogs,
  onToggleAutoScroll,
  onToggleShowLogs
}: {
  logs: LogEntry[]
  autoScroll: boolean
  showDetailedLogs: boolean
  onClearLogs: () => void
  onToggleAutoScroll: (checked: boolean) => void
  onToggleShowLogs: () => void
}) {
  const logsEndRef = useRef<HTMLDivElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  // 获取日志类型的样式
  const getLogTypeStyle = (type: LogEntry['type']) => {
    switch (type) {
      case 'progress':
        return 'text-blue-600'
      case 'complete':
        return 'text-green-600'
      case 'error':
        return 'text-red-600'
      case 'cancelled':
        return 'text-orange-600'
      case 'connection':
        return 'text-purple-600'
      default:
        return 'text-gray-600'
    }
  }

  if (logs.length === 0) return null

  return (
    <div className="mt-4 border-t pt-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="link" size="sm" onClick={onToggleShowLogs} className="h-auto p-0">
            {showDetailedLogs ? '隐藏' : '显示'}详细日志 ({logs.length}条)
          </Button>
          {showDetailedLogs && (
            <>
              <Button variant="link" size="sm" onClick={onClearLogs} className="h-auto p-0 text-xs">
                清空日志
              </Button>
              <label className="flex items-center gap-1 text-xs text-neutral-500">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => onToggleAutoScroll(e.target.checked)}
                  className="h-3 w-3"
                />
                自动滚动
              </label>
            </>
          )}
        </div>
      </div>

      {showDetailedLogs && (
        <div className="max-h-96 overflow-y-auto rounded border bg-neutral-50 p-3">
          <div className="space-y-1 font-mono text-xs">
            {logs.map((log, index) => (
              <div key={index} className="flex gap-2">
                <span className="text-neutral-400 shrink-0">{log.timestamp}</span>
                <Badge variant="outline" className={`shrink-0 text-xs ${getLogTypeStyle(log.type)}`}>
                  {log.type.toUpperCase()}
                </Badge>
                <span className="text-neutral-700">{log.message}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 扫描管理主组件 (已重构)
 */
function ScanManagement() {
  const { data: health } = useHealth()
  const scanPath = useScanPath()
  const cancelScan = useCancelScan() // 服务端取消

  // 统一的状态和动作 Hook
  const { state, actions } = useSseScan()
  const { streaming, progress, streamResult, streamError, logs, elapsed, retryCount } = state

  // 本地 UI 状态
  const [editPath, setEditPath] = useState('')
  const [editing, setEditing] = useState(false)
  const [metadataText, setMetadataText] = useState('')

  // --- 动作处理器 (转发到 Hook) ---

  // 开始编辑路径
  const startEditing = () => {
    setEditPath(scanPath.query.data?.scanPath || '')
    setEditing(true)
  }

  // 保存编辑路径
  const saveEditPath = () => {
    if (!editPath.trim()) return
    scanPath.update.mutate(editPath.trim(), {
      onSuccess: () => setEditing(false)
    })
  }

  // 启动客户端列表扫描 (POST)
  const startClientListStream = () => {
    const metadataList = metadataText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)

    if (metadataList.length === 0) {
      toast.error('请输入至少一行相对路径')
      return
    }

    actions.startScan({ metadataList })
  }

  // 启动服务端扫描 (GET)
  const startServerStream = (force: boolean) => {
    actions.startScan({ force })
  }

  // 取消当前扫描 (组合动作)
  const cancelCurrentScan = () => {
    actions.cancelScan() // 1. 立即停止客户端监听
    cancelScan.mutate() // 2. 通知服务端停止
  }

  const handleScan = () => {
    confirm({
      title: '确认强制扫描？',
      description:
        '强制全量扫描将会清空数据库中的所有艺术品、艺术家、图片和标签数据（用户和设置数据不受影响），然后重新扫描所有文件。此操作不可撤销，确定要继续吗？',
      variant: 'destructive',
      confirmText: '确认清空并扫描',
      onConfirm: () => {
        startServerStream(true)
      }
    })
  }

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 页面标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-neutral-900 mb-2">扫描管理</h1>
          <p className="text-neutral-600">管理艺术品扫描路径、监控扫描进度和查看详细日志</p>
        </div>

        <SCard
          title="扫描路径配置"
          extra={
            <Badge variant={health?.status === 'ok' ? 'default' : 'destructive'} className="ml-1">
              {health?.status || '加载中…'}
            </Badge>
          }
        >
          {!editing ? (
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="font-mono text-sm">
                {scanPath.query.data?.scanPath || '未配置'}
              </Badge>
              <Button variant="link" size="sm" onClick={startEditing} className="h-auto p-0">
                修改
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                type="text"
                value={editPath}
                onChange={(e) => setEditPath(e.target.value)}
                placeholder="请输入扫描目录的绝对路径"
                className="flex-1"
              />
              <Button onClick={saveEditPath} disabled={scanPath.update.isPending || !editPath.trim()}>
                {scanPath.update.isPending ? '保存中' : '保存'}
              </Button>
            </div>
          )}
        </SCard>

        <SCard
          title="客户端扫描"
          extra={
            <Button
              onClick={startClientListStream}
              disabled={streaming || !scanPath.query.data?.scanPath || !metadataText.trim()}
            >
              {streaming ? '进行中…' : '提交扫描'}
            </Button>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-neutral-700 mb-1">元数据相对路径列表</label>
              <textarea
                value={metadataText}
                onChange={(e) => setMetadataText(e.target.value)}
                placeholder={
                  '粘贴相对路径，一行一个\n示例：\n' +
                  '112349563/ー/137026182-meta.txt\n' +
                  '9645567/HALLOWEEN/136994763-meta.txt'
                }
                className="w-full min-h-32 rounded-md border border-neutral-200 bg-white p-2 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </SCard>

        {/* 3. 服务端扫描（GET）- 已简化 */}
        <SCard
          title="服务端扫描"
          action={
            <div className="flex items-center gap-2">
              <Button onClick={() => startServerStream(false)} disabled={streaming || !scanPath.query.data?.scanPath}>
                {streaming ? '进行中…' : '增量扫描'}
              </Button>
              <Button
                variant="secondary"
                onClick={handleScan}
                disabled={streaming || !scanPath.query.data?.scanPath}
                title="强制全量更新：清空现有数据后重建"
              >
                强制全量
              </Button>
            </div>
          }
        />

        {/* 4. 统一的状态、结果和日志区域 (新) */}
        {/* 仅在有任何活动或结果时显示此卡片 */}
        {(streaming || streamResult || streamError) && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{streaming ? '扫描进行中' : streamResult ? '扫描完成' : '扫描失败'}</CardTitle>
                {/* 统一的取消按钮 */}
                {streaming && (
                  <Button variant="destructive" onClick={cancelCurrentScan} disabled={cancelScan.isPending}>
                    {cancelScan.isPending ? '取消中' : '取消'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {/* 统一的进度条 */}
              {streaming && (
                <div className="space-y-2">
                  <div className="h-2 w-full overflow-hidden rounded bg-neutral-200">
                    <div className="h-2 w-1/3 animate-[progress_1.2s_ease-in-out_infinite] rounded bg-blue-500" />
                  </div>
                  <div className="text-sm text-neutral-600">
                    {progress?.message || '准备中…'} 已用时 {secondsToText(elapsed)}
                    {retryCount > 0 && ` (重连第${retryCount}次)`}
                  </div>
                </div>
              )}

              {/* 统一的错误显示 */}
              {streamError && (
                <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  实时通道：{streamError}
                </div>
              )}

              {/* 统一的结果显示 */}
              {streamResult && (
                <div className="mt-3 space-y-2 text-sm">
                  <div className="text-green-700">扫描成功完成</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Card className="p-3">
                      <div className="text-sm text-neutral-600">发现作品</div>
                      <div className="text-lg font-medium">{streamResult.totalArtworks}</div>
                    </Card>
                    <Card className="p-3">
                      <div className="text-sm text-neutral-600">新增作品</div>
                      <div className="text-lg font-medium">{streamResult.newArtworks}</div>
                    </Card>
                    <Card className="p-3">
                      <div className="text-sm text-neutral-600">新增图片</div>
                      <div className="text-lg font-medium">{streamResult.newImages}</div>
                    </Card>
                    {typeof streamResult.removedArtworks === 'number' && (
                      <Card className="p-3">
                        <div className="text-sm text-neutral-600">删除空作品</div>
                        <div className="text-lg font-medium">{streamResult.removedArtworks}</div>
                      </Card>
                    )}
                  </div>
                  {streamResult.errors?.length > 0 && (
                    <details className="rounded border bg-yellow-50 p-3">
                      <summary className="cursor-pointer text-yellow-800">
                        错误 {streamResult.errors.length} 条（展开查看）
                      </summary>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-yellow-900">
                        {streamResult.errors.slice(0, 20).map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                        {streamResult.errors.length > 20 && <li>… 仅展示前 20 条</li>}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {/* 统一的日志查看器 */}
              <ScanLogViewer
                logs={logs}
                autoScroll={actions.autoScroll}
                showDetailedLogs={actions.showDetailedLogs}
                onClearLogs={actions.clearLogs}
                onToggleAutoScroll={actions.setAutoScroll}
                onToggleShowLogs={() => actions.setShowDetailedLogs(!actions.showDetailedLogs)}
              />
            </CardContent>
          </Card>
        )}

        {/* 进度动画样式 (保持不变) */}
        <style>{`
          @keyframes progress {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(0%); }
            100% { transform: translateX(100%); }
          }
        `}</style>
      </div>
    </div>
  )
}

export default ScanManagement
