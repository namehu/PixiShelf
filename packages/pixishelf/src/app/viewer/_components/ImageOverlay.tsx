'use client'

import { RandomImageItem } from '@/types/images'
import { MoreHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useRef, useEffect, useMemo } from 'react'
import TagsPanel from './TagsPanel'
import { HeartAnimation } from './HeartAnimation'
import { TikTokStyleSidebar } from './TikTokStyleSidebar'
import { ActionDrawer } from './ActionDrawer'
import { useHeartAnimation } from '@/hooks/useHeartAnimation'
import { useViewerStore } from '@/store/viewerStore'
import dayjs from 'dayjs'
import { useShallow } from 'zustand/shallow'
import { useOptimisticAction } from 'next-safe-action/hooks'
import { toggleLikeAction } from '@/actions/like-action'

interface ImageOverlayProps {
  isActive: boolean
  image: RandomImageItem
}

/**
 * 图片覆盖层组件
 * 显示图片元信息和操作按钮，集成抖音风格侧边栏
 */
export default function ImageOverlay({ isActive, image }: ImageOverlayProps) {
  const { id, author, createdAt, title, description, tags = [] } = image
  const router = useRouter()

  const titleOpacity = useViewerStore((state) => state.titleOpacity)

  const [artworkLikeMap, syncImageLikeStatus] = useViewerStore(
    useShallow((state) => [state.artworkLikeMap, state.syncImageLikeStatus])
  )

  const [showActionDrawer, setShowActionDrawer] = useState(false)

  const interactiveZoneRef = useRef<HTMLDivElement>(null)

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

  // 集成爱心动画 Hook
  const {
    activeHearts,
    handleMouseDown: heartMouseDown,
    handleMouseUp: heartMouseUp,
    handleTouchStart,
    handleTouchEnd,
    isLongPressing
  } = useHeartAnimation({
    rapidClickConfig: {
      threshold: 3,
      timeWindow: 1000
    },
    longPressConfig: {
      threshold: 500
    },
    onTriggerHeart: () => {
      if (!isLiked) {
        execute({ artworkId: id })
      }
    }
  })

  // 拖拽检测状态
  const touchStartPos = useRef<{ x: number; y: number } | null>(null)
  const isDragging = useRef(false)

  // 集成事件处理逻辑
  const handleInteractionStart = (e: any) => {
    // 重置拖拽状态
    isDragging.current = false

    if ('touches' in e) {
      // 触摸事件
      const touch = e.touches[0]!
      touchStartPos.current = { x: touch.clientX, y: touch.clientY }
      handleTouchStart(e)
    } else {
      // 鼠标事件
      heartMouseDown(e)
    }
  }

  const handleInteractionMove = (e: React.TouchEvent) => {
    if (!touchStartPos.current || !e.touches.length) return

    const touch = e.touches[0]!
    const deltaX = Math.abs(touch.clientX - touchStartPos.current.x)
    const deltaY = Math.abs(touch.clientY - touchStartPos.current.y)

    // 如果移动距离超过阈值，认为是拖拽
    if (deltaX > 10 || deltaY > 10) {
      isDragging.current = true
    }
  }

  const handleInteractionEnd = (e: any) => {
    if ('changedTouches' in e) {
      // 触摸事件结束
      handleTouchEnd(e)
      touchStartPos.current = null
      isDragging.current = false
    } else {
      // 鼠标事件结束
      heartMouseUp(e)
    }
  }

  // 长按触发控制菜单
  const handleLongPress = () => {
    // console.log('长按事件触发了！')
    setShowActionDrawer(true)
  }

  // 监听长按状态变化
  useEffect(() => {
    if (isLongPressing) {
      handleLongPress()
    }
  }, [isLongPressing])

  return (
    <div className="absolute inset-0 pointer-events-none z-20">
      {/* 交互区域 - 支持点击和长按 */}
      <div
        ref={interactiveZoneRef}
        className="absolute"
        style={{
          width: '25%', // 进一步减小交互区域，避免干扰横向滑动
          height: '25%', // 进一步减小交互区域
          top: '50%',
          left: '50%',
          // background: 'rgba(255, 0, 0, 0.1)', // 调试时可以启用
          transform: 'translate(-50%, -50%)',
          touchAction: 'none', // 禁用默认触摸行为
          userSelect: 'none',
          WebkitUserSelect: 'none',
          pointerEvents: 'auto' // 只在这个小区域启用事件
        }}
        onMouseDown={handleInteractionStart}
        onMouseUp={handleInteractionEnd}
        onTouchStart={handleInteractionStart}
        onTouchMove={handleInteractionMove}
        onTouchEnd={handleInteractionEnd}
      />

      {/* 爱心动画渲染 */}
      {activeHearts.map((heart) => (
        <HeartAnimation key={heart.id} data={heart} />
      ))}

      {/* 抖音风格侧边栏 */}
      <div className={`transition-opacity duration-300  opacity-${titleOpacity}`}>
        {isActive && (
          <TikTokStyleSidebar
            image={image}
            liked={isLiked}
            onToggleLike={() => execute({ artworkId: id })}
            onMoreClick={() => setShowActionDrawer(true)}
          />
        )}
      </div>

      {/* 底部信息栏 */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 transition-opacity duration-300 pointer-events-auto opacity-${titleOpacity}`}
      >
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

      {/* 操作抽屉 */}
      <ActionDrawer open={showActionDrawer} onOpenChange={setShowActionDrawer} image={image} />
    </div>
  )
}
