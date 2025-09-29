'use client'

import { RandomImageItem } from '@/types/images'
import { User, MoreHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useRef, useCallback, useEffect } from 'react'
import TagsPanel from './TagsPanel'

interface ImageOverlayProps {
  image: RandomImageItem
}

/**
 * 图片覆盖层组件
 * 显示图片元信息和操作按钮
 */
export default function ImageOverlay({ image }: ImageOverlayProps) {
  const { author, createdAt, title, description, tags = [] } = image
  const router = useRouter()
  const [isVisible, setIsVisible] = useState(true)
  const [showControlMenu, setShowControlMenu] = useState(false)

  const interactiveZoneRef = useRef<HTMLDivElement>(null)

  const dayString = new Date(createdAt).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })

  const pressTimer = useRef<any>(null)
  const touchStartPos = useRef<{ x: number; y: number } | null>(null)
  const isDragging = useRef(false)
  const longPressTriggered = useRef(false)

  useEffect(() => {
    const longPressArea = interactiveZoneRef.current!

    function handleTouchStart(e: TouchEvent) {
      const touch = e.touches[0]
      touchStartPos.current = { x: touch.clientX, y: touch.clientY }
      isDragging.current = false
      longPressTriggered.current = false

      // 启动长按计时器
      pressTimer.current = setTimeout(() => {
        if (!isDragging.current) {
          longPressTriggered.current = true
          console.log('长按事件触发了！')
          setShowControlMenu(true)
          // 长按触发后阻止默认行为
          e.preventDefault()
        }
      }, 500)
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStartPos.current) return

      const touch = e.touches[0]
      const deltaX = touch.clientX - touchStartPos.current.x
      const deltaY = touch.clientY - touchStartPos.current.y
      const absDeltaX = Math.abs(deltaX)
      const absDeltaY = Math.abs(deltaY)

      // 设置滑动阈值为 15px，稍微提高阈值以减少误触
      const SWIPE_THRESHOLD = 15

      if (absDeltaX > SWIPE_THRESHOLD || absDeltaY > SWIPE_THRESHOLD) {
        // 检测到滑动，取消长按
        isDragging.current = true
        if (pressTimer.current) {
          clearTimeout(pressTimer.current)
          pressTimer.current = null
        }
      }

      // 不阻止任何事件传播，让 Swiper 组件自由处理所有手势
    }

    function handleTouchEnd(e: TouchEvent) {
      // 清除长按计时器
      if (pressTimer.current) {
        clearTimeout(pressTimer.current)
        pressTimer.current = null
      }

      // 如果触发了长按，不处理点击
      if (longPressTriggered.current) {
        longPressTriggered.current = false
        isDragging.current = false
        touchStartPos.current = null
        return
      }

      // 如果是拖拽，不处理点击
      if (isDragging.current) {
        isDragging.current = false
        touchStartPos.current = null
        return
      }

      // 处理点击事件
      setIsVisible(!isVisible)

      // 重置状态
      touchStartPos.current = null
    }

    // 鼠标事件处理（PC端）
    function handleMouseDown(e: MouseEvent) {
      if (e.button !== 0) return // 只处理左键

      pressTimer.current = setTimeout(() => {
        console.log('长按事件触发了！')
        setShowControlMenu(true)
      }, 500)
    }

    function handleMouseUp() {
      if (pressTimer.current) {
        clearTimeout(pressTimer.current)
        pressTimer.current = null
      }
    }

    function handleClick(e: MouseEvent) {
      // 只有在没有长按的情况下才处理点击
      if (!longPressTriggered.current) {
        setIsVisible(!isVisible)
      }
    }

    // 添加事件监听器，使用 passive: true 让事件更流畅地传播
    longPressArea.addEventListener('touchstart', handleTouchStart, { passive: true })
    longPressArea.addEventListener('touchmove', handleTouchMove, { passive: true })
    longPressArea.addEventListener('touchend', handleTouchEnd, { passive: true })

    // PC端事件
    longPressArea.addEventListener('mousedown', handleMouseDown)
    longPressArea.addEventListener('mouseup', handleMouseUp)
    longPressArea.addEventListener('mouseleave', handleMouseUp)
    longPressArea.addEventListener('click', handleClick)

    return () => {
      longPressArea.removeEventListener('touchstart', handleTouchStart)
      longPressArea.removeEventListener('touchmove', handleTouchMove)
      longPressArea.removeEventListener('touchend', handleTouchEnd)
      longPressArea.removeEventListener('mousedown', handleMouseDown)
      longPressArea.removeEventListener('mouseup', handleMouseUp)
      longPressArea.removeEventListener('mouseleave', handleMouseUp)
      longPressArea.removeEventListener('click', handleClick)
    }
  }, [isVisible])

  return (
    <>
      <div
        ref={interactiveZoneRef}
        className="absolute"
        style={{
          width: '50%',
          height: '40%',
          top: '50%',
          left: '50%',
          background: 'rgba(255, 0, 0, 0.1)', // 调试时可以启用
          transform: 'translate(-50%, -50%)',
          touchAction: 'manipulation',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          zIndex: 1, // 进一步降低层级
          pointerEvents: 'auto'
        }}
      ></div>
      {/* 顶部信息栏 */}
      <div
        className={`absolute top-0 left-0 right-0 bg-gradient-to-b from-black/60 via-black/30 to-transparent p-4 pl-16 transition-opacity duration-300 z-20 ${
          isVisible ? 'opacity-100' : 'opacity-30'
        }`}
      >
        <div className="flex items-center justify-between text-white">
          {/* 左侧：作者信息 */}
          <div
            className="flex items-center space-x-3 flex-1 min-w-0"
            onClick={() => author?.id && router.push(`/artists/${author.id}`)}
          >
            <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-font-semibold text-sm truncate opacity-90 ">@{author?.username}</p>
              <p className="text-xs opacity-60 flex-shrink-0 mt-1">{dayString}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 底部信息栏 */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4  transition-opacity duration-300 z-20 ${
          isVisible ? 'opacity-100' : 'opacity-30'
        }`}
      >
        <div
          className="text-white"
          onClick={() => {
            router.push(`/artworks/${image.id}`)
          }}
        >
          {/* 图片标题 */}
          <h3 className="font-bold text-lg mb-2 line-clamp-2">{title}</h3>

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
        ssN{' '}
      </div>

      {/* 长按控制菜单 */}
      {showControlMenu && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 m-4 max-w-xs w-full">
            <h3 className="text-lg font-semibold mb-4 text-center">操作菜单</h3>
            <div className="space-y-2">
              <button
                className="w-full p-3 text-left hover:bg-gray-100 rounded-lg transition-colors"
                onClick={() => {
                  setShowControlMenu(false)
                  router.push(`/artworks/${image.id}`)
                }}
              >
                查看详情
              </button>
              <button
                className="w-full p-3 text-left hover:bg-gray-100 rounded-lg transition-colors"
                onClick={() => {
                  setShowControlMenu(false)
                  if (author?.id) {
                    router.push(`/artists/${author.id}`)
                  }
                }}
              >
                查看作者
              </button>
              <button
                className="w-full p-3 text-left hover:bg-gray-100 rounded-lg transition-colors"
                onClick={() => setShowControlMenu(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
