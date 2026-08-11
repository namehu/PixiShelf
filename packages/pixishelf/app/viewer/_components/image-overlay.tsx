'use client'

import { RandomImageItem } from '@/types/images'
import { MoreHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import { ArtistAvatar } from '@/components/artwork/artist-avatar'
import TagsPanel from './tags-panel'
import { HeartAnimation } from './heart-animation'
import { LikeButton } from './like-button/inex'
import { ActionDrawer } from './action-drawer'
import { useHeartAnimation } from '@/hooks/use-heart-animation'
import { useViewerStore } from '@/store/viewer-store'
import dayjs from 'dayjs'
import { useShallow } from 'zustand/shallow'
import { useOptimisticAction } from 'next-safe-action/hooks'
import { toggleLikeAction } from '@/actions/like-action'

interface ImageOverlayProps {
  isActive: boolean
  image: RandomImageItem
  mediaControls?: ReactNode
  onInteractionApiChange?: (api: ViewerOverlayInteractionApi | null) => void
  onEnterClearMode: () => void
}

export interface ViewerOverlayInteractionApi {
  likeAt: (point: { x: number; y: number }) => void
  openActions: () => void
}

/**
 * 图片覆盖层组件
 * 显示图片元信息和紧凑操作按钮。
 */
export default function ImageOverlay({
  isActive,
  image,
  mediaControls,
  onInteractionApiChange,
  onEnterClearMode
}: ImageOverlayProps) {
  const { id, author, createdAt, title, description, tags = [] } = image
  const router = useRouter()

  const { artworkLikeMap, syncImageLikeStatus, isChromeHidden } = useViewerStore(
    useShallow((state) => ({
      artworkLikeMap: state.artworkLikeMap,
      syncImageLikeStatus: state.syncImageLikeStatus,
      isChromeHidden: state.isChromeHidden
    }))
  )

  const [showActionDrawer, setShowActionDrawer] = useState(false)

  const dayString = dayjs(createdAt).format('YYYY-MM-DD')

  // 从状态管理中获取当前图片的点赞状态
  const storeIsLiked = useMemo(() => artworkLikeMap.get(id) ?? false, [artworkLikeMap, id])

  const { execute, result, optimisticState } = useOptimisticAction(toggleLikeAction, {
    currentState: { isLiked: storeIsLiked },
    updateFn: (state) => ({ isLiked: !state.isLiked })
  })

  const isLiked = optimisticState.isLiked

  // 监听操作结果，成功后同步到全局 Store
  useEffect(() => {
    if (result.data !== undefined) {
      syncImageLikeStatus(id, result.data)
    }
  }, [result, id, syncImageLikeStatus])

  const { activeHearts, triggerHearts } = useHeartAnimation()

  const openActionDrawer = useCallback(() => {
    setShowActionDrawer(true)
  }, [])

  const handleActionDrawerOpenChange = useCallback((nextOpen: boolean) => {
    setShowActionDrawer(nextOpen)
  }, [])

  const likeAt = useCallback(
    (point: { x: number; y: number }) => {
      if (!isLiked) execute({ artworkId: id })
      triggerHearts(point, 5)
    },
    [execute, id, isLiked, triggerHearts]
  )

  useEffect(() => {
    onInteractionApiChange?.({ likeAt, openActions: openActionDrawer })
    return () => onInteractionApiChange?.(null)
  }, [likeAt, onInteractionApiChange, openActionDrawer])

  const handleArtistClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (author?.id) router.push(`/artists/${author.id}`)
  }

  const handleMoreClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    openActionDrawer()
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {/* 爱心动画渲染 */}
      {activeHearts.map((heart) => (
        <HeartAnimation key={heart.id} data={heart} />
      ))}

      {isActive && !isChromeHidden && (
        <div className="absolute inset-0 pointer-events-none">
          {/* 底部信息栏 */}
          <div
            role="region"
            aria-label="作品信息与操作"
            className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 ${
              isChromeHidden ? 'pointer-events-none' : 'pointer-events-auto'
            }`}
          >
            {mediaControls}
            <div className="text-white">
              {/* 图片标题 */}
              <h3
                className="mb-1 line-clamp-2 text-sm font-semibold leading-5"
                onClick={() => {
                  router.push(`/artworks/${image.id}`)
                }}
              >
                {title}
              </h3>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-label={`查看艺术家 ${author?.name || author?.username || '未知艺术家'}`}
                  disabled={!author?.id}
                  className="flex min-w-0 items-center gap-1.5 rounded-full text-left transition-opacity hover:opacity-85 disabled:cursor-default"
                  onClick={handleArtistClick}
                >
                  <ArtistAvatar src={author?.avatar} name={author?.name} className="size-7" />
                  <span className="flex min-w-0 items-center gap-1.5 text-xs leading-none">
                    <span className="truncate font-medium opacity-90">@{author?.username}</span>
                    <span aria-hidden="true" className="opacity-35">
                      ·
                    </span>
                    <span className="shrink-0 text-[11px] opacity-55">{dayString}</span>
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-1" role="group" aria-label="作品快捷操作">
                  <LikeButton
                    liked={isLiked}
                    onToggleLike={() => execute({ artworkId: id })}
                    className="size-8 border border-white/10 bg-black/20 p-0 shadow-none backdrop-blur-md hover:border-white/20 hover:bg-white/15 [&_svg]:size-[18px]"
                  />
                  <button
                    type="button"
                    aria-label="更多操作"
                    className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-black/20 text-white/90 backdrop-blur-md transition-all hover:scale-105 hover:border-white/20 hover:bg-white/15 hover:text-white active:scale-95"
                    onClick={handleMoreClick}
                  >
                    <MoreHorizontal className="size-4" />
                  </button>
                </div>
              </div>
              {/* 图片描述 */}
              {description && (
                <p
                  className="mb-2 overflow-hidden text-ellipsis text-xs leading-5 opacity-85"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    maxHeight: '2.5rem'
                  }}
                >
                  {description}
                </p>
              )}

              {/* 标签和时间 */}
              <div
                className="w-full"
                onClick={(ev) => {
                  ev.stopPropagation()
                  ev.preventDefault()
                }}
              >
                {/* 标签 */}
                {tags.length > 0 && (
                  <div
                    className="flex w-full flex-nowrap items-center gap-1.5 overflow-x-auto"
                    style={{
                      scrollbarWidth: 'none',
                      scrollbarColor: 'transparent transparent'
                    }}
                  >
                    {tags.slice(0, 3).map((tag, index) => (
                      <span
                        key={index}
                        className="shrink-0 cursor-pointer rounded-full bg-white/15 px-2 py-0.5 text-xs leading-4 transition-colors hover:bg-white/25"
                        onClick={() => router.push(`/tags/${tag.id}`)}
                      >
                        #{tag.name}
                      </span>
                    ))}
                    {tags.length > 3 && (
                      <TagsPanel
                        tags={tags}
                        trigger={
                          <div className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-xs leading-4 transition-colors hover:bg-white/25">
                            <MoreHorizontal className="size-3" />
                            <span>+{tags.length - 3}</span>
                          </div>
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 操作抽屉 */}
      <ActionDrawer
        open={showActionDrawer}
        onOpenChange={handleActionDrawerOpenChange}
        image={image}
        onEnterClearMode={() => {
          setShowActionDrawer(false)
          onEnterClearMode()
        }}
      />
    </div>
  )
}
