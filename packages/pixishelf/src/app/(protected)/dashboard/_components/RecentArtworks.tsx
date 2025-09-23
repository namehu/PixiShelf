import Link from 'next/link'
import { Card, CardContent } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/lib/constants'
import { EnhancedArtworksResponse } from '@/types'
import ArtworkGrid from './ArtworkGrid'

interface RecentArtworksProps {
  data: EnhancedArtworksResponse
  error?: string | null
}

/**
 * 最新作品展示组件
 */
export default function RecentArtworks({ data, error }: RecentArtworksProps) {
  // 如果有错误，显示错误信息
  if (error) {
    return (
      <div className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">最新作品</h3>
            <p className="text-gray-600">发现最新上传的精彩作品</p>
          </div>
          <Link href={ROUTES.GALLERY}>
            <Button variant="ghost" className="text-blue-600 hover:text-blue-700">
              查看全部 →
            </Button>
          </Link>
        </div>
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mb-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">最新作品</h3>
          <p className="text-gray-600">发现最新上传的精彩作品</p>
        </div>
        <Link href={ROUTES.GALLERY}>
          <Button variant="ghost" className="text-blue-600 hover:text-blue-700">
            查看全部 →
          </Button>
        </Link>
      </div>

      <ArtworkGrid initialData={data} />
    </div>
  )
}
