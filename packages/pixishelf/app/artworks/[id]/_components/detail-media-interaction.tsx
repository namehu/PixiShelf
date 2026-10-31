'use client'

import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { MediaMarkActions } from '@/components/media-mark/media-mark-actions'
import { useMediaMark } from '@/hooks/use-media-mark'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { FloatingLikeHearts, type FloatingLikeHeartsHandle } from '@/components/media-mark/floating-like-hearts'
import { useDetailMediaGestures, type DetailMediaMenuEvent } from './use-detail-media-gestures'
import { cn } from '@/lib/utils'

export function DetailMediaInteraction({
  artworkId,
  mediaId,
  label,
  children,
  onMenu,
  className,
  cancelRef
}: {
  artworkId: number
  mediaId: number
  label: string
  children: ReactNode
  onMenu: (event: DetailMediaMenuEvent) => void
  className?: string
  cancelRef?: RefObject<(() => void) | null>
}) {
  const mark = useMediaMark(artworkId, mediaId)
  const hearts = useRef<FloatingLikeHeartsHandle>(null)
  const { cancel, surfaceProps } = useDetailMediaGestures({
    mediaId,
    onMenu,
    onLike: (point) => {
      if (mark.isLoading || !mark.available) return
      useArtworkAutoBrowseStore.getState().pause('manual')
      if (!mark.likedAt) mark.set('like', true)
      hearts.current?.show(point)
    }
  })
  useEffect(() => {
    if (cancelRef) cancelRef.current = cancel
    return () => {
      if (cancelRef) cancelRef.current = null
    }
  }, [cancelRef, cancel])
  return (
    <div className={cn('relative', className)}>
      <div
        {...surfaceProps}
        data-detail-media-surface
        role="group"
        tabIndex={0}
        aria-label={`${label}，双击喜欢，长按或按回车打开图片操作`}
        className="h-full select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&_img]:pointer-events-none [&_img]:[-webkit-touch-callout:none]"
        style={{ touchAction: 'pan-y pinch-zoom', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
      >
        {children}
      </div>
      {mark.likedAt && (
        <div className="absolute bottom-2 left-2" data-long-press-ignore>
          <MediaMarkActions
            artworkId={artworkId}
            mediaId={mediaId}
            showBookmark={false}
            likeAppearance="bare"
            overlay
            onAction={() => {
              cancel()
              useArtworkAutoBrowseStore.getState().pause('manual')
            }}
          />
        </div>
      )}
      <FloatingLikeHearts key={mediaId} ref={hearts} />
    </div>
  )
}
