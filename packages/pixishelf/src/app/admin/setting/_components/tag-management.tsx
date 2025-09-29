'use client'

import React, { useState } from 'react'
import { RefreshCw, BarChart3, Clock, CheckCircle, AlertCircle } from 'lucide-react'

/**
 * 标签管理组件
 *
 * 功能：
 * - 手动触发标签统计更新
 * - 显示最后更新时间
 * - 显示更新状态和进度
 * - 提供标签统计概览
 */
function TagManagement() {
  const [isUpdating, setIsUpdating] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 手动更新标签统计
  const handleUpdateStats = async () => {
    setIsUpdating(true)
    setUpdateStatus('idle')
    setErrorMessage(null)

    try {
      const response = await fetch('/api/tags/update-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const data = await response.json()

      if (data.success) {
        setUpdateStatus('success')
        setLastUpdate(new Date().toLocaleString('zh-CN'))
      } else {
        setUpdateStatus('error')
        setErrorMessage(data.message || '更新失败')
      }
    } catch (error) {
      setUpdateStatus('error')
      setErrorMessage(error instanceof Error ? error.message : '网络错误')
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="border-b border-neutral-200 pb-4">
        <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
          <BarChart3 className="w-6 h-6" />
          标签管理
        </h1>
        <p className="text-neutral-600 mt-1">管理标签统计数据，手动更新标签作品数量</p>
      </div>

      {/* 统计更新卡片 */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-neutral-900">标签统计更新</h2>
          <div className="flex items-center gap-2 text-sm text-neutral-500">
            <Clock className="w-4 h-4" />
            定时更新：每天凌晨 2:00
          </div>
        </div>

        {/* 状态显示 */}
        {updateStatus === 'success' && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="text-green-800">标签统计更新成功</span>
          </div>
        )}

        {updateStatus === 'error' && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <div className="text-red-800">
              <div>标签统计更新失败</div>
              {errorMessage && <div className="text-sm mt-1 text-red-600">{errorMessage}</div>}
            </div>
          </div>
        )}

        {/* 最后更新时间 */}
        {lastUpdate && <div className="mb-4 text-sm text-neutral-600">最后手动更新时间：{lastUpdate}</div>}

        {/* 更新按钮 */}
        <button
          onClick={handleUpdateStats}
          disabled={isUpdating}
          className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${isUpdating ? 'animate-spin' : ''}`} />
          {isUpdating ? '正在更新...' : '手动更新统计'}
        </button>

        <p className="text-sm text-neutral-500 mt-2">手动更新将重新计算所有标签的作品数量，可能需要几分钟时间</p>
      </div>

      {/* 说明信息 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">关于标签统计</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• 标签统计会自动在每天凌晨 2:00 更新</li>
          <li>• 手动更新适用于需要立即同步数据的情况</li>
          <li>• 更新过程中系统性能可能会受到轻微影响</li>
          <li>• 建议在系统使用较少的时间进行手动更新</li>
        </ul>
      </div>
    </div>
  )
}

export default TagManagement
