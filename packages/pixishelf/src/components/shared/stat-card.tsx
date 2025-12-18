import * as React from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

interface StatCardProps extends React.ComponentProps<typeof Card> {
  /** 指标标题 */
  title: string
  /** 核心数值 */
  value: React.ReactNode
  /** 图标 (可选) */
  icon?: React.ReactNode
  /** 描述/趋势信息 (可选) */
  description?: React.ReactNode
  /** 是否加载中 */
  loading?: boolean
}

export function StatCard({ title, value, icon, description, loading = false, className, ...props }: StatCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)} {...props}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground tracking-tight">{title}</CardTitle>
        {/* 如果有图标，显示在右上角 */}
        {icon && <div className="text-muted-foreground h-4 w-4">{icon}</div>}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-24" />{' '}
            {/* 如果没有 Skeleton 组件，用 <div className="h-8 w-24 animate-pulse bg-muted rounded" /> 替代 */}
            <Skeleton className="h-3 w-32" />
          </div>
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
