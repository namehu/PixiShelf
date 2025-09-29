'use client'

import { RandomImageItem } from '@/types/images'
import { User } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface ImageOverlayProps {
  image: RandomImageItem
}

/**
 * 图片覆盖层组件
 * 显示图片元信息和操作按钮
 */
export default function ImageOverlay({ image }: ImageOverlayProps) {
  const { author, createdAt, title, description, tags } = image
  const router = useRouter()
  const dayString = new Date(createdAt).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })

  return (
    <>
      {/* 顶部信息栏 */}
      <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/60 via-black/30 to-transparent p-4 pl-16 ">
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
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pb-6">
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
                  <span className="px-2 py-1 bg-white/20 rounded-full text-xs">+{tags.length - 3}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
