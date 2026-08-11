'use client'

import { RandomImageItem } from '@/types/images'
import { MoreHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import TagsPanel from './tags-panel'
import { HeartAnimation } from './heart-animation'
import { TikTokStyleSidebar } from './tik-tok-style-sidebar'
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
 * 显示图片元信息和操作按钮，集成抖音风格侧边栏
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

  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {/* 爱心动画渲染 */}
      {activeHearts.map((heart) => (
        <HeartAnimation key={heart.id} data={heart} />
      ))}

      {isActive && !isChromeHidden && (
        <div className="absolute inset-0 pointer-events-none">
          {/* 抖音风格侧边栏 */}
          {isActive && (
            <div className={isChromeHidden ? 'pointer-events-none' : 'pointer-events-auto'}>
              <TikTokStyleSidebar
                image={image}
                liked={isLiked}
                onToggleLike={() => execute({ artworkId: id })}
                onMoreClick={openActionDrawer}
              />
            </div>
          )}

          {/* 底部信息栏 */}
          <div
            className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 ${
              isChromeHidden ? 'pointer-events-none' : 'pointer-events-auto'
            }`}
          >
            {mediaControls}
            <div className="text-white">
              {/* 图片标题 */}
              <h3
                className="font-bold text-lg mb-2 line-clamp-2"
                onClick={() => {
                  router.push(`/artworks/${image.id}`)
                }}
              >
                {title}
              </h3>
              <div
                className="flex items-center mb-2 space-x-2"
                onClick={() => author?.id && router.push(`/artists/${author.id}`)}
              >
                <p className="text-font-semibold text-sm truncate opacity-90 ">@{author?.username}</p>
                <p className="text-xs opacity-60 flex-shrink-0">{dayString}</p>
              </div>
              {/* 图片描述 */}
              {description && (
                <p
                  className="text-sm opacity-90 mb-3 leading-relaxed overflow-hidden text-ellipsis"
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: '1.4em',
                    maxHeight: '2.8em'
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
                    className="flex flex-nowrap gap-2 items-center w-full overflow-x-auto"
                    style={{
                      scrollbarWidth: 'none',
                      scrollbarColor: 'transparent transparent'
                    }}
                  >
                    {tags.slice(0, 3).map((tag, index) => (
                      <span
                        key={index}
                        className="px-2 py-1 bg-white/20 rounded-full text-xs cursor-pointer hover:bg-white/30 transition-colors flex-shrink-0"
                        onClick={() => router.push(`/tags/${tag.id}`)}
                      >
                        #{tag.name}
                      </span>
                    ))}
                    {tags.length > 3 && (
                      <TagsPanel
                        tags={tags}
                        trigger={
                          <div className="px-2 py-1 bg-white/20 rounded-full text-xs hover:bg-white/30 transition-colors flex items-center gap-1 cursor-pointer flex-shrink-0">
                            <MoreHorizontal className="w-3 h-3" />
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
