'use client'

import React, { useState } from 'react'
import { RefreshCw, Clock, CheckCircle, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { updateTagStatsAction } from '@/actions/tag-action'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface TagStatsUpdateCardProps {
  onUpdateStats: () => void
}

/**
 * 标签统计更新卡片组件
 *
 * 功能：
 * - 手动更新标签统计
 * - 显示更新状态和最后更新时间
 * - 包含更新按钮和状态提示
 */
export function TagStatsUpdateCard({ onUpdateStats }: TagStatsUpdateCardProps) {
  // 标签统计更新状态
  const [isUpdatingStats, setIsUpdatingStats] = useState(false)
  const [lastStatsUpdate, setLastStatsUpdate] = useState<string | null>(null)
  const [statsUpdateStatus, setStatsUpdateStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [statsUpdateError, setStatsUpdateError] = useState<string | null>(null)

  // 手动更新标签统计
  const handleUpdateStats = async () => {
    try {
      setIsUpdatingStats(true)
      setStatsUpdateStatus('idle')
      setStatsUpdateError(null)

      const result = await updateTagStatsAction()
      const data = result?.data

      if (data?.success) {
        setStatsUpdateStatus('success')
        setLastStatsUpdate(new Date().toLocaleString('zh-CN'))
        toast.success('标签统计更新成功')

        // 刷新页面数据以显示最新统计
        onUpdateStats()
      } else {
        throw new Error(result?.serverError || data?.message || '更新失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '标签统计更新失败'
      setStatsUpdateStatus('error')
      setStatsUpdateError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsUpdatingStats(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-background p-4 md:p-6" aria-labelledby="tag-stats-title">
      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-4">
        <h2 id="tag-stats-title" className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <RefreshCw className="size-5" aria-hidden="true" />
          标签统计更新
        </h2>
        <div className="flex-1 hidden md:block" />

        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          {lastStatsUpdate && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="size-4" aria-hidden="true" />
              <span className="md:hidden">最后更新：</span>
              {lastStatsUpdate}
            </div>
          )}
          {/* 更新按钮 */}
          <Button
            onClick={handleUpdateStats}
            disabled={isUpdatingStats}
            className="w-full md:w-auto"
          >
            <RefreshCw data-icon="inline-start" aria-hidden="true" className={isUpdatingStats ? 'animate-spin' : undefined} />
            {isUpdatingStats ? '正在更新…' : '手动更新统计'}
          </Button>
        </div>
      </div>

      {/* 更新状态显示 */}
      {statsUpdateStatus === 'success' && (
        <Alert variant="success" className="mb-4">
          <CheckCircle aria-hidden="true" />
          <AlertTitle>标签统计更新成功</AlertTitle>
        </Alert>
      )}

      {statsUpdateStatus === 'error' && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>标签统计更新失败</AlertTitle>
          {statsUpdateError && <AlertDescription>{statsUpdateError}</AlertDescription>}
        </Alert>
      )}

      <p className="mt-3 text-sm text-muted-foreground">手动更新将重新计算所有标签的作品数量，可能需要几分钟时间</p>
    </section>
  )
}
