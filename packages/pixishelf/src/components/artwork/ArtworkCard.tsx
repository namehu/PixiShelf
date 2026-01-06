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
    <Link href={`/artworks/${id}`} className="group block">
      {/* 作品封面 */}
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-gray-100 mb-2">
        <Image
          src={src}
          alt={title}
          width={400}
          height={533}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading={priority ? 'eager' : 'lazy'}
          priority={priority}
        />

        {/* 遮罩层 - 悬停时微微变暗增加层次感 */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />

        <div className="absolute top-2 right-2 flex flex-col gap-1">
          {/* 图片数量标识 */}
          {mediaType === 'image' && imageCount > 1 && (
            <div className="bg-black/50 backdrop-blur-sm text-white px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1">
              <ImageIcon size={10} />
              {imageCount}
            </div>
          )}
          {/* 视频icon */}
          {mediaType === 'video' && totalMediaSize > 0 && (
            <div className="bg-black/50 backdrop-blur-sm text-white px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1">
              <VideoIcon size={10} />
              {formatFileSize(totalMediaSize)}
            </div>
          )}
        </div>
      </div>

      {/* 作品信息 */}
      <div className="space-y-0.5 px-0.5">
        <h4 className="font-bold text-sm text-gray-900 truncate leading-snug group-hover:text-blue-600 transition-colors">
          {title}
        </h4>
        {name && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span className="truncate hover:text-gray-700 transition-colors">{name}</span>
          </div>
        )}
      </div>
    </Link>
  )
}
