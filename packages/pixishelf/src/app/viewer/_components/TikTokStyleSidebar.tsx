'use client'

import React from 'react'
import { RandomImageItem } from '@/types/images'
import { ArtistAvatar } from '@/components/artwork/ArtistAvatar'
import { LikeButton } from './like-button/inex'
import { Share, MessageCircle, MoreHorizontal, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface TikTokStyleSidebarProps {
  image: RandomImageItem
  className?: string
  /** 更多按钮点击回调 */
  onMoreClick?: () => void
}

/**
 * 抖音风格侧边栏组件
 * 竖向布局，包含用户头像、点赞按钮、分享按钮等操作
 */
export const TikTokStyleSidebar: React.FC<TikTokStyleSidebarProps> = ({ image, className, onMoreClick }) => {
  const router = useRouter()
  const { author, id: artworkId } = image

  // 处理关注按钮点击
  const handleFollowClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // TODO: 实现关注功能
    console.log('关注用户:', author?.id)
  }

  // 处理分享按钮点击
  const handleShareClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // TODO: 实现分享功能
    console.log('分享作品:', artworkId)
  }

  // 处理评论按钮点击
  const handleCommentClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    router.push(`/artworks/${artworkId}#comments`)
  }

  // 处理更多操作按钮点击
  const handleMoreClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onMoreClick?.()
  }

  // 处理用户头像点击
  const handleAvatarClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (author?.id) {
      router.push(`/artists/${author.id}`)
    }
  }

  return (
    <div
      className={cn(
        'fixed right-4 top-1/2 transform -translate-y-1/2 z-30 flex flex-col items-center space-y-4',
        'pointer-events-auto',
        className
      )}
    >
      {/* 用户头像区域 */}
      <div className="relative">
        <div
          className="cursor-pointer hover:scale-105 active:scale-95 ring-2 ring-white/20 hover:ring-white/40 transition-all rounded-full"
          onClick={handleAvatarClick}
        >
          <ArtistAvatar src={author?.avatar} name={author?.name} size={12} />
        </div>
      </div>

      {/* 点赞按钮 */}
      <div className="flex flex-col items-center">
        <LikeButton artworkId={artworkId} />
      </div>

      {/* 更多操作按钮 */}
      <div className="flex flex-col items-center">
        <button
          onClick={handleMoreClick}
          className={cn(
            'w-12 h-12 bg-black/20 hover:bg-black/30 backdrop-blur-sm',
            'rounded-full flex items-center justify-center',
            'text-white hover:text-gray-300',
            'transition-all duration-200 hover:scale-105 active:scale-95',
            'shadow-lg'
          )}
          aria-label="更多操作"
        >
          <MoreHorizontal size={24} />
        </button>
        <span className="text-white text-xs mt-1 font-medium">更多</span>
      </div>
    </div>
  )
}

export default TikTokStyleSidebar
