import Link from 'next/link'
import { EnhancedArtwork } from '@/types'
import { ImageIcon, ImagePlayIcon } from 'lucide-react'

import ClientImage from '@/components/client-image'

interface ArtworkCardProps {
  artwork: EnhancedArtwork
}

/**
 * 作品卡片组件（服务端组件）
 */
export default function ArtworkCard({ artwork }: ArtworkCardProps) {
  const { imageCount, videoCount, totalMediaSize = 0, images = [], artist } = artwork
  const src = images[0]?.path ?? ''
  const artistName = artist?.name

  console.log(artwork, 'artwork')

  return (
    <Link href={`/artworks/${artwork.id}`} className="block">
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">
        {/* 作品封面 */}
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-gray-100">
          <ClientImage
            src={src}
            alt={artwork.title}
            width={400}
            height={533}
            className="h-full w-full object-cover"
            loading="lazy"
          />

          <div className="absolute top-3 right-3">
            {/* 图片数量标识 */}
            {imageCount > 1 && (
              <div className=" bg-black/70 backdrop-blur-sm text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1">
                <ImageIcon size={12}></ImageIcon>
                {artwork.imageCount}
              </div>
            )}

            {totalMediaSize > 0 && (
              <div className="bg-red-600/80 backdrop-blur-sm text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1">
                <ImagePlayIcon size={12}></ImagePlayIcon>
                {(totalMediaSize / (1024 * 1024)).toFixed(1)}M
              </div>
            )}
          </div>
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
