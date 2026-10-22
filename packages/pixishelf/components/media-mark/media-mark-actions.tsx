'use client'

import { BookmarkIcon, HeartIcon, RotateCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMediaMark } from '@/hooks/use-media-mark'
import { cn } from '@/lib/utils'

export function MediaMarkActions({ artworkId, mediaId, layout = 'icons', overlay = false }: {
  artworkId: number
  mediaId: number | null
  layout?: 'icons' | 'menu'
  overlay?: boolean
}) {
  const mark = useMediaMark(artworkId, mediaId)
  if (mark.error && !mark.available) {
    return (
      <Button type="button" variant="ghost" className="min-h-11" onClick={() => void mark.retry()}>
        <RotateCwIcon data-icon="inline-start" aria-hidden="true" />重试图片标记
      </Button>
    )
  }
  return (
    <div role="group" aria-label="当前图片标记" className={cn('flex gap-1', layout === 'menu' && 'flex-col')}>
      {([
        { kind: 'bookmark', active: Boolean(mark.bookmarkedAt), Icon: BookmarkIcon, add: '添加图片书签', remove: '取消图片书签' },
        { kind: 'like', active: Boolean(mark.likedAt), Icon: HeartIcon, add: '喜欢这张图片', remove: '取消图片喜欢' }
      ] as const).map(({ kind, active, Icon, add, remove }) => (
        <Button key={kind} type="button" variant={layout === 'menu' ? 'ghost' : 'secondary'}
          aria-label={active ? remove : add} aria-pressed={active} aria-busy={mark.isSaving}
          disabled={mark.isLoading || !mark.available} title={active ? remove : add}
          className={cn('min-h-11 min-w-11', layout === 'icons' ? 'size-11 shrink-0 rounded-full p-0' : 'w-full justify-start',
            overlay && 'bg-black/35 text-white hover:bg-white/20 hover:text-white focus-visible:ring-white')}
          onClick={(event) => { event.stopPropagation(); mark.set(kind, !active) }}>
          <Icon aria-hidden="true" className={cn('size-5', active && 'fill-current')} />
          {layout === 'menu' ? (active ? remove : add) : null}
        </Button>
      ))}
    </div>
  )
}
