'use client'

import { RandomImageItem } from '@/types/images'
import { MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { ArtistAvatar } from '@/components/artwork/artist-avatar'
import TagsPanel from './tags-panel'
import { LikeButton } from './like-button/inex'
import { ActionDrawer } from './action-drawer'
import { useViewerStore } from '@/store/viewer-store'
import dayjs from 'dayjs'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { useAuthUser } from '@/components/auth'
import { useArtworkRating } from '@/hooks/use-artwork-rating'
import { ARTWORK_RATING_LABELS, isArtworkLiked } from '@/schemas/artwork-rating.dto'
import { toast } from 'sonner'

interface ImageOverlayProps {
  isActive: boolean
  image: RandomImageItem
  currentMediaId?: number | null
  mediaControls?: ReactNode
  onInteractionApiChange?: (api: ViewerOverlayInteractionApi | null) => void
  onHideChrome: () => void
  onPanelOpenChange?: (open: boolean) => void
}

export interface ViewerOverlayInteractionApi {
  openActions: () => void
}

/**
 * 图片覆盖层组件
 * 显示图片元信息和紧凑操作按钮。
 */
export default function ImageOverlay({
  isActive,
  image,
  currentMediaId = null,
  mediaControls,
  onInteractionApiChange,
  onHideChrome,
  onPanelOpenChange
}: ImageOverlayProps) {
  const { id, author, createdAt, title, description, tags = [] } = image
  const ownerUserId = useAuthUser()?.id
  const isChromeHidden = useViewerStore((state) => state.isChromeHidden)
  const rating = useArtworkRating(id, image.ratingLevel)
  const isLiked = isArtworkLiked(rating.level)
  const ratingLabel = rating.level === null ? '未评分' : ARTWORK_RATING_LABELS[rating.level]
  const likeActionLabel = isLiked ? `当前评分：${ratingLabel}；取消喜欢并清除评分` : `当前评分：${ratingLabel}；喜欢作品`
  useEffect(() => {
    if (rating.error && isActive) {
      toast.error('评分未保存，请重试。', {
        id: `artwork-rating-${ownerUserId}-${id}`,
        action: { label: '重试', onClick: rating.retry }
      })
    }
  }, [id, isActive, ownerUserId, rating.error, rating.retry])

  const [showActionDrawer, setShowActionDrawer] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  useEffect(() => {
    if (isActive) onPanelOpenChange?.(showActionDrawer || tagsOpen)
  }, [isActive, onPanelOpenChange, showActionDrawer, tagsOpen])
  useEffect(() => {
    if (!isActive) return
    return () => onPanelOpenChange?.(false)
  }, [isActive, onPanelOpenChange])

  const dayString = dayjs(createdAt).format('YYYY-MM-DD')

  const openActionDrawer = useCallback(() => {
    setShowActionDrawer(true)
  }, [])

  const handleActionDrawerOpenChange = useCallback((nextOpen: boolean) => {
    setShowActionDrawer(nextOpen)
  }, [])

  useEffect(() => {
    onInteractionApiChange?.({ openActions: openActionDrawer })
    return () => onInteractionApiChange?.(null)
  }, [onInteractionApiChange, openActionDrawer])

  const stopOverlayPropagation = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation()
  }

  const handleMoreClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    openActionDrawer()
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {isActive && (
        <>
          {/* 底部信息栏 */}
          <div
            role="region"
            hidden={isChromeHidden && !mediaControls}
            data-viewer-control
            aria-label={isChromeHidden ? '浏览进度' : '作品信息与操作'}
            className="pointer-events-auto absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3"
          >
            {mediaControls}
            <div
              aria-hidden={isChromeHidden}
              inert={isChromeHidden}
              className={cn('flex flex-col gap-1 text-white', isChromeHidden && 'hidden')}
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex min-w-0 items-center gap-1.5 text-xs leading-6">
                    {author?.id ? (
                      <Link
                        href={`/artists/${author.id}`}
                        aria-label={`查看艺术家 ${author.name || author.username || '未知艺术家'}`}
                        className="flex min-w-0 items-center gap-1.5 rounded-sm text-left outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-white/70"
                        onClick={stopOverlayPropagation}
                      >
                        <ArtistAvatar src={author.avatar} name={author.name} size={5} className="shrink-0" />
                        <PrivacySensitiveText className="truncate font-medium opacity-90">
                          {author.name || author.username || '未知艺术家'}
                        </PrivacySensitiveText>
                      </Link>
                    ) : (
                      <span className="truncate opacity-70">未知艺术家</span>
                    )}
                    <span aria-hidden="true" className="opacity-40">
                      ·
                    </span>
                    <time dateTime={createdAt} className="shrink-0 text-[11px] text-white/60">
                      {dayString}
                    </time>
                  </div>
                  <Link
                    href={`/artworks/${image.id}`}
                    className="block truncate rounded-sm text-sm leading-5 font-semibold outline-none underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-white/70"
                    onClick={stopOverlayPropagation}
                  >
                    <PrivacySensitiveText>{title || '未命名作品'}</PrivacySensitiveText>
                  </Link>
                </div>

                <div className="flex shrink-0 items-center gap-1" role="group" aria-label="作品快捷操作">
                  <LikeButton
                    liked={isLiked}
                    disabled={rating.isLoading || !ownerUserId}
                    saving={rating.isSaving}
                    label={likeActionLabel}
                    onToggleLike={() => {
                      if (ownerUserId) rating.setLevel(isLiked ? null : 2)
                    }}
                    className="size-11 bg-transparent p-0 shadow-none backdrop-blur-none hover:bg-white/10 [&_svg]:size-[18px]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="更多操作"
                    className="size-11 rounded-full text-white/90 hover:bg-white/10 hover:text-white focus-visible:ring-white/70"
                    onClick={handleMoreClick}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {/* 图片描述 */}
              {description && (
                <PrivacySensitiveText as="p" className="truncate text-xs leading-5 text-white/70">
                  {description}
                </PrivacySensitiveText>
              )}

              {/* 标签保持单行，完整列表由抽屉承载。 */}
              {tags.length > 0 && (
                <div
                  className="flex w-full flex-nowrap items-center gap-1.5 overflow-x-auto"
                  style={{
                    scrollbarWidth: 'none',
                    scrollbarColor: 'transparent transparent'
                  }}
                >
                  {tags.slice(0, 3).map((tag) => (
                    <Link
                      key={tag.id}
                      href={`/tags/${tag.id}`}
                      className="inline-flex h-7 max-w-40 shrink-0 items-center rounded-sm px-1 text-xs leading-4 text-white/70 outline-none underline-offset-4 hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
                      onClick={stopOverlayPropagation}
                    >
                      <PrivacySensitiveText className="truncate">#{tag.name}</PrivacySensitiveText>
                    </Link>
                  ))}
                  {tags.length > 3 && (
                    <TagsPanel
                      tags={tags}
                      onOpenChange={setTagsOpen}
                      trigger={
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={`查看其余 ${tags.length - 3} 个标签`}
                          className="h-7 shrink-0 rounded-full px-2 text-xs leading-4 text-white/70 hover:bg-white/10 hover:text-white focus-visible:ring-inset focus-visible:ring-white/70"
                          onClick={stopOverlayPropagation}
                        >
                          <MoreHorizontal data-icon="inline-start" aria-hidden="true" />
                          <span>+{tags.length - 3}</span>
                        </Button>
                      }
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* 操作抽屉 */}
      <ActionDrawer
        open={showActionDrawer}
        onOpenChange={handleActionDrawerOpenChange}
        image={image}
        currentMediaId={currentMediaId}
        onHideChrome={() => {
          setShowActionDrawer(false)
          onHideChrome()
        }}
      />
    </div>
  )
}
