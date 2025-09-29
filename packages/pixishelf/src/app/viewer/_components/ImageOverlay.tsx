'use client'

import { RandomImageItem } from '@/types/images'
import { User, MoreHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useRef, useCallback } from 'react'
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

  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
  const longPressStarted = useRef(false)

  const dayString = new Date(createdAt).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })

  // 处理点击切换显隐
  const handleToggleVisibility = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setIsVisible(!isVisible)
    },
    [isVisible]
  )

  // 处理长按开始
  const handleLongPressStart = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault()
    longPressStarted.current = true
    longPressTimer.current = setTimeout(() => {
      if (longPressStarted.current) {
        setShowControlMenu(true)
      }
    }, 500)
  }, [])

  // 处理长按结束
  const handleLongPressEnd = useCallback(() => {
    longPressStarted.current = false
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  return (
    <>
      {/* 透明度控制层 */}
      <div
      // className="absolute inset-0 z-10"
      // onClick={handleToggleVisibility}
      // onMouseDown={handleLongPressStart}
      // onMouseUp={handleLongPressEnd}
      // onMouseLeave={handleLongPressEnd}
      // onTouchStart={handleLongPressStart}
      // onTouchEnd={handleLongPressEnd}
      // onTouchCancel={handleLongPressEnd}
      />

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
        className={`absolute bottom-4 left-4 right-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pb-6 transition-opacity duration-300 z-20 ${
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
          {description && <p className="text-sm opacity-90 mb-3 line-clamp-3 leading-relaxed">{description}</p>}

          {/* 标签和时间 */}
          <div
            className="flex items-center justify-between flex-wrap gap-2"
            onClick={(ev) => {
              ev.stopPropagation()
              ev.preventDefault()
            }}
          >
            {/* 标签 */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 flex-1">
                {tags.slice(0, 3).map((tag, index) => (
                  <span
                    key={index}
                    className="px-2 py-1 bg-white/20 rounded-full text-xs cursor-pointer"
                    onClick={() => router.push(`/tags/${tag.id}`)}
                  >
                    #{tag.name}
                  </span>
                ))}
                {tags.length > 3 && (
                  <TagsPanel
                    tags={tags}
                    trigger={
                      <div className="px-2 py-1 bg-white/20 rounded-full text-xs hover:bg-white/30 transition-colors flex items-center gap-1">
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
