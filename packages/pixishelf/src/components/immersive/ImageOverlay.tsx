'use client'

import { ImageItem } from '@/hooks/useInfiniteImages'
import { Heart, Bookmark, Share2, User } from 'lucide-react'
import { useState } from 'react'

interface ImageOverlayProps {
  image: ImageItem
  onLike?: () => void
  onBookmark?: () => void
  onShare?: () => void
}

/**
 * 图片覆盖层组件
 * 显示图片元信息和操作按钮
 */
export default function ImageOverlay({ image, onLike, onBookmark, onShare }: ImageOverlayProps) {
  const [isLiked, setIsLiked] = useState(false)
  const [isBookmarked, setIsBookmarked] = useState(false)

  // const handleLike = () => {
  //   setIsLiked(!isLiked)
  //   onLike?.()
  // }

  // const handleBookmark = () => {
  //   setIsBookmarked(!isBookmarked)
  //   onBookmark?.()
  // }

  // const handleShare = () => {
  //   if (navigator.share) {
  //     navigator.share({
  //       title: image.title,
  //       text: image.description,
  //       url: window.location.href
  //     })
  //   } else {
  //     // 降级处理：复制链接到剪贴板
  //     navigator.clipboard.writeText(window.location.href)
  //   }
  //   onShare?.()
  // }

  return (
    <>
      {/* 底部信息栏 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pb-6">
        <div className="text-white">
          {/* 作者信息 */}
          {image.author && (
            <div className="flex items-center space-x-2 mb-2">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                <User className="w-4 h-4" />
              </div>
              <div>
                <p className="font-semibold text-sm">{image.author.name}</p>
                {image.author.username && <p className="text-xs opacity-70">@{image.author.username}</p>}
              </div>
            </div>
          )}

          {/* 图片标题 */}
          <h3 className="font-bold text-lg mb-1 line-clamp-2">{image.title}</h3>

          {/* 图片描述 */}
          {image.description && <p className="text-sm opacity-80 mb-2 line-clamp-3">{image.description}</p>}

          {/* 标签 */}
          {image.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {image.tags.slice(0, 3).map((tag, index) => (
                <span key={index} className="px-2 py-1 bg-white/20 rounded-full text-xs">
                  #{tag}
                </span>
              ))}
              {image.tags.length > 3 && (
                <span className="px-2 py-1 bg-white/20 rounded-full text-xs">+{image.tags.length - 3}</span>
              )}
            </div>
          )}

          {/* 创建时间 */}
          <p className="text-xs opacity-60">
            {new Date(image.createdAt).toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            })}
          </p>
        </div>
      </div>

      {/* 右侧操作按钮 */}
      {/* <div className="absolute right-4 bottom-20 flex flex-col space-y-4">
        <button
          onClick={handleLike}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
            isLiked
              ? 'bg-red-500 text-white scale-110'
              : 'bg-black/40 text-white hover:bg-black/60'
          }`}
          aria-label="点赞"
        >
          <Heart
            className={`w-6 h-6 ${isLiked ? 'fill-current' : ''}`}
          />
        </button>

        <button
          onClick={handleBookmark}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
            isBookmarked
              ? 'bg-yellow-500 text-white scale-110'
              : 'bg-black/40 text-white hover:bg-black/60'
          }`}
          aria-label="收藏"
        >
          <Bookmark
            className={`w-6 h-6 ${isBookmarked ? 'fill-current' : ''}`}
          />
        </button>

        <button
          onClick={handleShare}
          className="w-12 h-12 rounded-full bg-black/40 text-white hover:bg-black/60 flex items-center justify-center transition-all duration-200 hover:scale-110"
          aria-label="分享"
        >
          <Share2 className="w-6 h-6" />
        </button>
      </div> */}
    </>
  )
}
