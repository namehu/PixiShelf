'use client'

import { Tag, CheckCircle, XCircle, TrendingUp } from 'lucide-react'
import { TagManagementStats } from '@/types'
import { AdminMetric } from '../../_components/admin-workbench'

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
      icon: Tag
    },
    {
      title: '已翻译',
      value: stats.translatedTags,
      icon: CheckCircle
    },
    {
      title: '未翻译',
      value: stats.untranslatedTags,
      icon: XCircle
    },
    {
      title: '翻译率',
      value: `${stats.translationRate.toFixed(1)}%`,
      icon: TrendingUp
    }
  ]

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-x-6 xl:grid-cols-4" aria-busy="true" aria-label="正在加载标签统计…">
        {statsCards.map((card) => (
          <AdminMetric key={card.title} label={card.title} value="—" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-x-6 xl:grid-cols-4" aria-label="标签统计">
      {statsCards.map((card) => {
        const IconComponent = card.icon
        return (
          <AdminMetric
            key={card.title}
            label={card.title}
            value={typeof card.value === 'number' ? card.value.toLocaleString('zh-CN') : card.value}
            icon={<IconComponent className="size-4" aria-hidden="true" />}
          />
        )
      })}
    </div>
  )
}
