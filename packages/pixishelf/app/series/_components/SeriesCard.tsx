import Link from 'next/link'
import { Layers } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

export interface SeriesCardItem {
  id: number
  title: string
  coverImageUrl: string | null
  artworkCount: number
  updatedAt: Date
}

interface SeriesCardProps {
  series: SeriesCardItem
  priority?: boolean
  className?: string
}

/**
 * 系列卡片组件
 * 样式与 ArtworkCard 保持一致
 */
export default function SeriesCard({ series, priority = false, className }: SeriesCardProps) {
  const { id, title, coverImageUrl, artworkCount, updatedAt } = series

  return (
    <Link href={`/series/${id}`} className={cn('group block', className)}>
      {/* 封面区域 */}
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-gray-100 mb-2">
        {coverImageUrl ? (
          <Image
            src={coverImageUrl}
            alt={title}
            width={400}
            height={533}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading={priority ? 'eager' : 'lazy'}
            priority={priority}
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 20vw"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground bg-gray-100 text-xs">
            No Cover
          </div>
        )}

        {/* 遮罩层 - 悬停时微微变暗增加层次感 */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />

        {/* 右上角标识 - 作品数量 */}
        <div className="absolute top-2 right-2 flex flex-col gap-1">
          {artworkCount > 0 && (
            <div className="bg-black/50 backdrop-blur-sm text-white px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1">
              <Layers size={10} />
              {artworkCount}
            </div>
          )}
        </div>
      </div>

      {/* 信息区域 */}
      <div className="space-y-0.5 px-0.5">
        <h4 className="font-bold text-sm text-gray-900 truncate leading-snug group-hover:text-blue-600 transition-colors" title={title}>
          {title}
        </h4>
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <span className="truncate">{new Date(updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </Link>
  )
}
