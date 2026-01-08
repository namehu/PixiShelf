'use client'

import React from 'react'
import { Tag, CheckCircle, XCircle, TrendingUp } from 'lucide-react'
import { TagManagementStats } from '@/types'

interface TagStatsCardsProps {
  stats: TagManagementStats
  isLoading?: boolean
}

/**
 * 标签统计卡片组件
 *
 * 功能：
 * - 显示标签总数、已翻译、未翻译、翻译率等统计卡片
 * - 纯展示组件，接收统计数据作为props
 */
export function TagStatsCards({ stats, isLoading = false }: TagStatsCardsProps) {
  const statsCards = [
    {
      title: '标签总数',
      value: stats.totalTags,
      icon: Tag,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200'
    },
    {
      title: '已翻译',
      value: stats.translatedTags,
      icon: CheckCircle,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200'
    },
    {
      title: '未翻译',
      value: stats.untranslatedTags,
      icon: XCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      borderColor: 'border-red-200'
    },
    {
      title: '翻译率',
      value: `${stats.translationRate.toFixed(1)}%`,
      icon: TrendingUp,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      borderColor: 'border-purple-200'
    }
  ]

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-4 md:mb-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="bg-white rounded-lg border border-neutral-200 p-4 md:p-6">
            <div className="animate-pulse">
              <div className="flex items-center mb-2 md:mb-4">
                <div className="w-6 h-6 md:w-8 md:h-8 bg-neutral-200 rounded-lg"></div>
                <div className="ml-2 md:ml-3 h-3 md:h-4 bg-neutral-200 rounded w-12 md:w-16"></div>
              </div>
              <div className="h-6 md:h-8 bg-neutral-200 rounded w-10 md:w-12"></div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-4 md:mb-6">
      {statsCards.map((card, index) => {
        const IconComponent = card.icon
        return (
          <div
            key={index}
            className={`bg-white rounded-lg border ${card.borderColor} p-4 md:p-6 transition-all duration-200 hover:shadow-md`}
          >
            <div className="flex items-center mb-2 md:mb-4">
              <div className={`p-1.5 md:p-2 rounded-lg ${card.bgColor}`}>
                <IconComponent className={`w-4 h-4 md:w-6 md:h-6 ${card.color}`} />
              </div>
              <h3 className="ml-2 md:ml-3 text-xs md:text-sm font-medium text-neutral-600">{card.title}</h3>
            </div>
            <div className="text-lg md:text-2xl font-bold text-neutral-900">{card.value}</div>
          </div>
        )
      })}
    </div>
  )
}
