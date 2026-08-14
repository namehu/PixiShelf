import Link from 'next/link'
import type { Tag } from '@/types'
import { getTranslateName } from '@/utils/tags'
import { cn } from '@/lib/utils'

interface TagItemProps {
  tag: Tag
  size?: 'sm' | 'md' | 'lg'
}

export function TagItem({ tag, size = 'md' }: TagItemProps) {
  const translatedName = getTranslateName(tag)

  return (
    <article
      className={cn(
        'flex min-w-0 items-center gap-3 rounded-md border border-border bg-background text-foreground shadow-xs transition-[border-color,background-color] hover:border-primary/35 hover:bg-primary/[0.03]',
        size === 'sm' && 'min-h-9 px-3 py-1.5 text-xs',
        size === 'md' && 'min-h-11 px-4 py-2 text-sm',
        size === 'lg' && 'min-h-14 px-5 py-3 text-base'
      )}
    >
      <div className="min-w-0 flex-1 leading-tight">
        <Link
          href={`/tags/${tag.id}`}
          className="block truncate font-semibold outline-none hover:text-primary focus-visible:text-primary"
        >
          {tag.name}
        </Link>
        {size !== 'sm' && translatedName && (
          <p className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">{translatedName}</p>
        )}
      </div>
      <span className="font-utility shrink-0 text-xs text-muted-foreground">{tag.artworkCount}</span>
    </article>
  )
}
