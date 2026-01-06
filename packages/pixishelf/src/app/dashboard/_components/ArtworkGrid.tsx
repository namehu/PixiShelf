'use client'

import { Card, CardContent } from '@/components/ui/card'
import { ImageIcon } from 'lucide-react'
import { EnhancedArtworksResponse } from '@/types'
import ArtworkCard from '@/components/artwork/ArtworkCard'

interface ArtworkGridProps {
  initialData: EnhancedArtworksResponse
}

/**
 * 作品网格客户端组件
 * 负责处理作品列表的动态渲染和状态管理
 */
export default function ArtworkGrid({ initialData }: ArtworkGridProps) {
  if (initialData?.items?.length) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {initialData.items.map((artwork, index) => (
          <ArtworkCard key={artwork.id} artwork={artwork as any} priority={index < 4} />
        ))}
      </div>
    )
  }

  return (
    <Card>
      <CardContent className="p-12 text-center">
        <ImageIcon size={52} className="text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">暂无作品</h3>
        <p className="text-gray-600 mb-4">还没有任何作品，快去发现精彩内容吧！</p>
      </CardContent>
    </Card>
  )
}
