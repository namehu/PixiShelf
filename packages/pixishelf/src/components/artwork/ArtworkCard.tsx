import Link from 'next/link'
import { ImageIcon, VideoIcon } from 'lucide-react'
import Image from 'next/image'
import { formatFileSize } from '@/utils/media'
import { ArtworkResponseDto } from '@/schemas/artwork.dto'

interface ArtworkCardProps {
  artwork: ArtworkResponseDto
  priority?: boolean
}

/**
 * 作品卡片组件
 */
export default function ArtworkCard({ artwork, priority = false }: ArtworkCardProps) {
  const { id, title, imageCount, totalMediaSize = 0, images = [], artist } = artwork

  const { path: src = '', mediaType } = images[0] ?? {}
  const { name } = artist ?? {}

  return (
    <Link href={`/artworks/${id}`} className="block">
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">
        {/* 作品封面 */}
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-gray-100">
          <Image
            src={src}
            alt={title}
            width={400}
            height={533}
            className="h-full w-full object-cover"
            loading={priority ? 'eager' : 'lazy'}
            priority={priority}
          />

          <div className="absolute top-3 right-3">
            {/* 图片数量标识 */}
            {mediaType === 'image' && imageCount > 1 && (
              <div className=" bg-black/70 backdrop-blur-sm text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1">
                <ImageIcon size={12}></ImageIcon>
                {imageCount}
              </div>
            )}
            {/* 视频icon */}
            {mediaType === 'video' && totalMediaSize > 0 && (
              <div className="bg-red-600/80 backdrop-blur-sm text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1">
                <VideoIcon size={12}></VideoIcon>
                {formatFileSize(totalMediaSize)}
              </div>
            )}
          </div>
        </div>

        {/* 作品信息 */}
        <div className="p-4 space-y-2">
          <h4 className="font-medium text-gray-900 truncate">{title}</h4>
          {name && <p className="text-sm text-gray-600 truncate">{name}</p>}
        </div>
      </div>
    </Link>
  )
}
