'use client'

import { BookmarkIcon, HeartIcon, RotateCwIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { useMediaMark } from '@/hooks/use-media-mark'
import { cn } from '@/lib/utils'

export function MediaMarkActions({ artworkId, mediaId, layout = 'icons', overlay = false, showBookmark = true }: {
  artworkId: number
  mediaId: number | null
  layout?: 'icons' | 'menu'
  overlay?: boolean
  showBookmark?: boolean
}) {
  const mark = useMediaMark(artworkId, mediaId)
  const reducedMotion = useReducedMotion()
  if (mark.error && !mark.available) {
    return (
      <Button type="button" variant="secondary" className={cn('min-h-11', overlay && 'media-mark-overlay')} onClick={(event) => { event.stopPropagation(); void mark.retry() }}>
        <RotateCwIcon data-icon="inline-start" aria-hidden="true" />重试图片标记
      </Button>
    )
  }
  return (
    <div role="group" aria-label="当前图片标记" className={cn('flex gap-1', layout === 'menu' && 'flex-col')}>
      {([
        { kind: 'bookmark', active: Boolean(mark.bookmarkedAt), Icon: BookmarkIcon, add: '添加图片书签', remove: '取消图片书签' },
        { kind: 'like', active: Boolean(mark.likedAt), Icon: HeartIcon, add: '喜欢这张图片', remove: '取消图片喜欢' }
      ] as const).filter(({ kind }) => showBookmark || kind !== 'bookmark').map(({ kind, active, Icon, add, remove }) => (
        <Button key={kind} type="button" variant={layout === 'menu' ? 'ghost' : 'secondary'}
          aria-label={active ? remove : add} aria-pressed={active} aria-busy={mark.isSaving}
          disabled={mark.isLoading || !mark.available} title={active ? remove : add}
          className={cn('min-h-11 min-w-11', layout === 'icons' ? 'size-11 shrink-0 rounded-full p-0' : 'w-full justify-start',
            overlay && 'media-mark-overlay motion-safe:active:scale-90')}
          onClick={(event) => { event.stopPropagation(); mark.set(kind, !active) }}>
          <motion.span
            className="flex"
            initial={false}
            animate={{ scale: overlay && active && !reducedMotion ? [1, 1.22, 1] : 1 }}
            transition={{ duration: reducedMotion ? 0 : 0.24, ease: 'easeOut' }}
          >
            <Icon aria-hidden="true" data-icon={layout === 'menu' ? 'inline-start' : undefined} className={cn(active && 'fill-current')} />
          </motion.span>
          {layout === 'menu' ? (active ? remove : add) : null}
        </Button>
      ))}
    </div>
  )
}
