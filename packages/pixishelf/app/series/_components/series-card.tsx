import Link from 'next/link'
import { cn } from '@/lib/utils'
import MediaThumbnail from '@/components/media/media-thumbnail'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

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

export default function SeriesCard({ series, priority = false, className }: SeriesCardProps) {
  const { id, title, coverImageUrl, artworkCount, updatedAt } = series
  const href = `/series/${id}`

  return (
    <article className={cn('group min-w-0', className)}>
      <Link
        href={href}
        aria-label={`查看系列：${title}`}
        className="relative mb-3 block aspect-[3/4] overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <MediaThumbnail
          media={coverImageUrl ? { path: coverImageUrl, mediaType: 'image' } : null}
          alt={title}
          width={400}
          height={533}
          className="size-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.02]"
          loading={priority ? 'eager' : 'lazy'}
          priority={priority}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
        />
      </Link>

      <PrivacySensitiveText as="h2" className="truncate text-sm font-semibold text-foreground">
        <Link href={href} className="outline-none hover:text-primary focus-visible:text-primary">
          {title}
        </Link>
      </PrivacySensitiveText>
      <div className="font-utility mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{artworkCount} 件作品</span>
        <span>{new Date(updatedAt).toLocaleDateString('zh-CN')} 更新</span>
      </div>
    </article>
  )
}
