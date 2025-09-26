import { EnhancedArtworksResponse } from '@/types'
import ArtworkGrid from './ArtworkGrid'

interface RecommendedArtworksProps {
  initialData: EnhancedArtworksResponse
}

/**
 * 推荐作品展示组件
 * 结合服务端静态部分和客户端动态部分
 */
export default function RecommendedArtworks({ initialData }: RecommendedArtworksProps) {
  return (
    <div className="mb-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">推荐作品</h3>
          <p className="text-gray-600">为您精心挑选的优质作品</p>
        </div>
      </div>

      <ArtworkGrid initialData={initialData} enableRefresh={true} refreshEndpoint="/api/artworks/recommendations" />
    </div>
  )
}
