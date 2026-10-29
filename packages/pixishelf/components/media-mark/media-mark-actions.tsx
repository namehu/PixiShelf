'use client'

import { Fragment, useEffect, type ReactNode } from 'react'
import { BookmarkIcon, HeartIcon, RotateCwIcon } from 'lucide-react'
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { useMediaMark } from '@/hooks/use-media-mark'
import { cn } from '@/lib/utils'

export function MediaMarkActions({
  artworkId,
  mediaId,
  layout = 'icons',
  overlay = false,
  showBookmark = true,
  children
}: {
  artworkId: number
  mediaId: number | null
  layout?: 'icons' | 'menu'
  overlay?: boolean
  showBookmark?: boolean
  /** Preview controls between the stable bookmark and like buttons. */
  children?: ReactNode
}) {
  const mark = useMediaMark(artworkId, mediaId)
  const reducedMotion = useReducedMotion()
  const bookmarkAnimation = useAnimationControls()
  const likeAnimation = useAnimationControls()
  useEffect(() => {
    bookmarkAnimation.set({ scale: 1 })
    likeAnimation.set({ scale: 1 })
    return () => {
      bookmarkAnimation.stop()
      likeAnimation.stop()
    }
  }, [mediaId, bookmarkAnimation, likeAnimation])

  return (
    <div
      role="group"
      aria-label="当前图片标记"
      className={cn(
        'relative flex gap-1',
        layout === 'menu' && 'flex-col',
        overlay && 'max-w-full items-center justify-center gap-3 sm:gap-6'
      )}
    >
      {(
        [
          {
            kind: 'bookmark',
            active: Boolean(mark.bookmarkedAt),
            Icon: BookmarkIcon,
            add: '添加图片书签',
            remove: '取消图片书签'
          },
          { kind: 'like', active: Boolean(mark.likedAt), Icon: HeartIcon, add: '喜欢这张图片', remove: '取消图片喜欢' }
        ] as const
      )
        .filter(({ kind }) => showBookmark || kind !== 'bookmark')
        .map(({ kind, active, Icon, add, remove }) => (
          <Fragment key={kind}>
            {kind === 'like' && children ? <div className="min-w-0">{children}</div> : null}
            <Button
              type="button"
              variant={layout === 'menu' ? 'ghost' : 'secondary'}
              aria-label={active ? remove : add}
              aria-pressed={active}
              aria-busy={mark.isLoading || mark.isSaving}
              disabled={mark.isLoading || !mark.available}
              title={active ? remove : add}
              className={cn(
                'min-h-11 min-w-11',
                layout === 'icons' ? 'size-11 shrink-0 rounded-full p-0' : 'w-full justify-start',
                overlay && 'media-mark-overlay size-12 disabled:opacity-100 [&_svg]:size-6'
              )}
              onClick={(event) => {
                event.stopPropagation()
                mark.set(kind, !active)
                if (overlay && !active && !reducedMotion) {
                  const controls = kind === 'bookmark' ? bookmarkAnimation : likeAnimation
                  controls.stop()
                  void controls.start({ scale: [1, 1.22, 1], transition: { duration: 0.24, ease: 'easeOut' } })
                }
              }}
            >
              <motion.span
                className="flex"
                initial={false}
                animate={kind === 'bookmark' ? bookmarkAnimation : likeAnimation}
              >
                <Icon
                  aria-hidden="true"
                  data-icon={layout === 'menu' ? 'inline-start' : undefined}
                  className={cn(overlay && 'size-6', active && 'fill-current')}
                />
              </motion.span>
              {layout === 'menu' ? (active ? remove : add) : null}
            </Button>
          </Fragment>
        ))}
      {mark.error && !mark.available && (
        <Button
          type="button"
          variant="secondary"
          className={cn(
            'min-h-11',
            overlay && 'media-mark-overlay absolute bottom-full left-1/2 mb-2 -translate-x-1/2'
          )}
          onClick={(event) => {
            event.stopPropagation()
            void mark.retry()
          }}
        >
          <RotateCwIcon data-icon="inline-start" aria-hidden="true" />
          重试图片标记
        </Button>
      )}
    </div>
  )
}
