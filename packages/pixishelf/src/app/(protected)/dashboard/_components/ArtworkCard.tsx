import Link from 'next/link'
import { EnhancedArtwork } from '@/types'
import Image from 'next/image'
import imgproxyLoader from '../../../../../lib/image-loader.js'

interface ArtworkCardProps {
  artwork: EnhancedArtwork
  showRecommendedBadge?: boolean
}

/**
 * 作品卡片组件（服务端组件）
 */
export default function ArtworkCard({ artwork, showRecommendedBadge = false }: ArtworkCardProps) {
  const cover = artwork.images?.[0]?.path ?? ''
  const src = cover
  const artistName = artwork.artist?.name

  return (
    <Link href={`/artworks/${artwork.id}`} className="block">
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">
        {/* 作品封面 */}
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-gray-100">
          {src ? (
            <Image
              src={src}
              alt={artwork.title}
              width={400}
              height={533}
              loader={imgproxyLoader as any}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full bg-gray-200 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}

          {/* 图片数量标识 */}
          {artwork.imageCount > 1 && (
            <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-sm text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              {artwork.imageCount}
            </div>
          )}

          {/* 推荐标识 */}
          {showRecommendedBadge && (
            <div className="absolute top-3 left-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white px-2 py-1 rounded-lg text-xs font-medium">
              推荐
            </div>
          )}
        </div>

        {/* 作品信息 */}
        <div className="p-4 space-y-2">
          <h4 className="font-medium text-gray-900 truncate" title={artwork.title}>
            {artwork.title}
          </h4>
          {artistName && (
            <p className="text-sm text-gray-600 truncate" title={artistName}>
              {artistName}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
