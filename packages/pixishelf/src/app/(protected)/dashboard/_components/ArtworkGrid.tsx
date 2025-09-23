'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { EnhancedArtworksResponse } from '@/types'
import { apiJson } from '@/lib/api'
import ArtworkCard from './ArtworkCard'

interface ArtworkGridProps {
  initialData: EnhancedArtworksResponse
  enableRefresh?: boolean
  recommand?: boolean
  refreshEndpoint?: string
}

/**
 * 作品网格客户端组件
 * 负责处理作品列表的动态渲染和状态管理
 */
export default function ArtworkGrid({
  initialData,
  enableRefresh = false,
  recommand,
  refreshEndpoint
}: ArtworkGridProps) {
  const [data, setData] = useState(initialData)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRefresh = async () => {
    if (!enableRefresh || !refreshEndpoint) return

    try {
      setIsLoading(true)
      setError(null)
      const response = await apiJson<EnhancedArtworksResponse>(refreshEndpoint)
      setData(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取数据失败')
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl shadow-sm overflow-hidden animate-pulse">
            <div className="aspect-[3/4] bg-gray-200"></div>
            <div className="p-4 space-y-2">
              <div className="h-4 bg-gray-200 rounded"></div>
              <div className="h-3 bg-gray-200 rounded w-2/3"></div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-red-600">{error}</p>
          {enableRefresh && (
            <Button onClick={handleRefresh} className="mt-4">
              重试
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  if (data && data.items.length > 0) {
    return (
      <>
        {enableRefresh && (
          <div className="flex justify-end mb-6">
            <Button
              variant="ghost"
              className="text-blue-600 hover:text-blue-700 flex items-center gap-2"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              刷新推荐
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {data.items.map((artwork) => (
            <ArtworkCard key={artwork.id} showRecommendedBadge={recommand ?? false} artwork={artwork} />
          ))}
        </div>
      </>
    )
  }

  return (
    <Card>
      <CardContent className="p-12 text-center">
        <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 mb-2">暂无作品</h3>
        <p className="text-gray-600 mb-4">还没有任何作品，快去发现精彩内容吧！</p>
        {enableRefresh && <Button onClick={handleRefresh}>刷新</Button>}
      </CardContent>
    </Card>
  )
}
