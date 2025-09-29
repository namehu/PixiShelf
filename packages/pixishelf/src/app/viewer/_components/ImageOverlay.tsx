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

  useEffect(() => {
    const longPressArea = interactiveZoneRef.current!

    function handleTouchStart(e: any) {
      console.log(11111111)

      // 启动一个定时器，500毫秒后触发长按事件
      pressTimer.current = setTimeout(() => {
        // 清除定时器，防止重复触发
        clearTimeout(pressTimer.current)
        pressTimer.current = null
        // 在这里执行你的长按逻辑
        console.log('长按事件触发了！')
        longPressArea.textContent = '长按成功！'

        // 可选：在这里阻止默认行为（如弹出菜单），如果需要的话
        // e.preventDefault();
      }, 500) // 500ms 定义为长按
    }

    // 如果手指在定时器结束前抬起，则清除定时器，判定为单击或短按
    function handleTouchEnd() {
      clearTimeout(pressTimer.current)
    }
    // 监听触摸开始事件
    longPressArea.addEventListener('touchstart', handleTouchStart)
    // 监听触摸结束事件
    longPressArea.addEventListener('touchend', handleTouchEnd)
    // 关键一步：监听触摸移动事件
    longPressArea.addEventListener('touchmove', handleTouchEnd)

    // 为了兼容PC端鼠标操作，可以添加对应的 mousedown, mouseup, mouseleave 事件
    longPressArea.addEventListener('mousedown', handleTouchStart)
    longPressArea.addEventListener('mouseup', handleTouchEnd)
    longPressArea.addEventListener('mouseleave', handleTouchEnd)

    return () => {
      longPressArea.removeEventListener('touchstart', handleTouchStart)
      longPressArea.removeEventListener('touchend', handleTouchEnd)
      longPressArea.removeEventListener('touchmove', handleTouchEnd)
      longPressArea.removeEventListener('mousedown', handleTouchStart)
      longPressArea.removeEventListener('mouseup', handleTouchEnd)
      longPressArea.removeEventListener('mouseleave', handleTouchEnd)
    }
  }, [])

  return (
    <>
      <div
        ref={interactiveZoneRef}
        className="absolute z-20"
        style={{
          width: '60%',
          height: '50%',
          top: '50%',
          left: '50%',
          // background: 'red',
          transform: 'translate(-50%, -50%)'
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
