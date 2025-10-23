'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RefreshCw, ImageIcon } from 'lucide-react'
import { EnhancedArtworksResponse } from '@/types'
import { apiJson } from '@/lib/api'
import ArtworkCard from '@/components/artwork/ArtworkCard'

interface ArtworkGridProps {
  initialData: EnhancedArtworksResponse
  enableRefresh?: boolean
  refreshEndpoint?: string
}

/**
 * 作品网格客户端组件
 * 负责处理作品列表的动态渲染和状态管理
 */
export default function ArtworkGrid({ initialData, enableRefresh = false, refreshEndpoint }: ArtworkGridProps) {
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

  if (data?.items?.length) {
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
            <ArtworkCard key={artwork.id} artwork={artwork} />
          ))}
        </div>
      </>
    )
  }

  return (
    <Card>
      <CardContent className="p-12 text-center">
        <ImageIcon size={52} className="text-gray-300 mx-auto mb-4"></ImageIcon>
        <h3 className="text-lg font-medium text-gray-900 mb-2">暂无作品</h3>
        <p className="text-gray-600 mb-4">还没有任何作品，快去发现精彩内容吧！</p>
        {enableRefresh && <Button onClick={handleRefresh}>刷新</Button>}
      </CardContent>
    </Card>
  )
}
