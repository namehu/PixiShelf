'use client'

import React, { useState } from 'react'
import { RefreshCw, Clock, CheckCircle, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { updateTagStatsAction } from '@/actions/tag-action'

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

      if (result.success) {
        setStatsUpdateStatus('success')
        setLastStatsUpdate(new Date().toLocaleString('zh-CN'))
        toast.success('标签统计更新成功')

        // 刷新页面数据以显示最新统计
        onUpdateStats()
      } else {
        throw new Error(result.message || '更新失败')
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
    <div className="bg-white rounded-lg border border-neutral-200 p-4 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-4">
        <h2 className="text-lg font-semibold text-neutral-900 flex items-center gap-2">
          <RefreshCw className="w-5 h-5" />
          标签统计更新
        </h2>
        <div className="flex-1 hidden md:block"></div>
        
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          {lastStatsUpdate && (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <Clock className="w-4 h-4" />
              <span className="md:hidden">最后更新：</span>
              {lastStatsUpdate}
            </div>
          )}
          {/* 更新按钮 */}
          <Button
            onClick={handleUpdateStats}
            disabled={isUpdatingStats}
            className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${isUpdatingStats ? 'animate-spin' : ''}`} />
            {isUpdatingStats ? '正在更新...' : '手动更新统计'}
          </Button>
        </div>
      </div>

      {/* 更新状态显示 */}
      {statsUpdateStatus === 'success' && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 text-green-800">
            <CheckCircle className="w-4 h-4" />
            <div>标签统计更新成功</div>
          </div>
        </div>
      )}

      {statsUpdateStatus === 'error' && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 text-red-800">
            <AlertCircle className="w-4 h-4" />
            <div>
              <div>标签统计更新失败</div>
              {statsUpdateError && <div className="text-sm mt-1 text-red-600">{statsUpdateError}</div>}
            </div>
          </div>
        </div>
      )}

      <p className="text-sm text-neutral-500 mt-3">手动更新将重新计算所有标签的作品数量，可能需要几分钟时间</p>
    </div>
  )
}
