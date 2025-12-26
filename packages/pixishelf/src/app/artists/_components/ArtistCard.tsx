import React from 'react'
import { Artist } from '@/types'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { ImageIcon, Calendar, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Image from 'next/image'

interface ArtistCardProps {
  artist: Artist
  onClick?: () => void
}

export function ArtistCard({ artist, onClick }: ArtistCardProps) {
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <div
      className="group relative overflow-hidden border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-none transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.2)] dark:hover:border-gray-700 cursor-pointer rounded-xl"
      onClick={onClick}
    >
      {/* 顶部 Banner 区域 */}
      <div className="h-28 w-full overflow-hidden bg-gray-50 dark:bg-gray-800 relative">
        {artist.backgroundImg ? (
          <Image
            src={artist.backgroundImg}
            alt=""
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/10">
            {/* 如果没有背景图，用头像做个模糊背景 */}
            {artist.avatar && (
              <Image
                src={artist.avatar}
                alt=""
                className="h-full w-full object-cover opacity-20 blur-2xl scale-150 mix-blend-overlay"
              />
            )}
            <div className="absolute inset-0 bg-[url('/patterns/grid.svg')] opacity-[0.05]" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </div>

      {/* 内容区域 */}
      <div className="px-5 pb-5">
        <div className="flex justify-between items-start -mt-10 mb-3 relative z-10">
          {/* 头像 */}
          <Avatar className="size-[72px] border-[3px] border-white dark:border-gray-900 shadow-md bg-white dark:bg-gray-900">
            <AvatarImage src={artist.avatar} className="object-cover" />
            <AvatarFallback className="bg-primary/5 text-primary text-xl font-bold">
              {getInitials(artist.name)}
            </AvatarFallback>
          </Avatar>

          {/* 关注按钮 (UI Only) */}
          <Button
            size="sm"
            variant="secondary"
            className="h-8 rounded-full px-4 text-xs font-medium bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm shadow-sm hover:bg-primary hover:text-white transition-all border border-transparent hover:border-primary/20 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 duration-300 mt-10"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            关注
          </Button>
        </div>

        {/* 文本信息 */}
        <div className="space-y-1 mb-3">
          <h3 className="text-[17px] font-bold text-gray-900 dark:text-white truncate leading-tight group-hover:text-primary transition-colors">
            {artist.name}
          </h3>
          <div className="flex items-center gap-2 text-xs">
            {artist.username && (
              <span className="text-gray-400 dark:text-gray-500 font-medium truncate max-w-[120px]">
                @{artist.username}
              </span>
            )}
            <span className="w-0.5 h-0.5 rounded-full bg-gray-300 dark:bg-gray-600" />
            <span className="text-gray-400 dark:text-gray-500">ID: {artist.id}</span>
          </div>
        </div>

        {/* 简介 */}
        <div className="h-[2.5rem] mb-4">
          <p className="text-[13px] text-gray-600 dark:text-gray-300 line-clamp-2 leading-relaxed">
            {artist.bio || '这位画师很懒，什么都没写...'}
          </p>
        </div>

        {/* 底部数据 */}
        <div className="flex items-center gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 group-hover:bg-primary/5 group-hover:text-primary transition-colors">
            <ImageIcon className="w-3.5 h-3.5" />
            <span className="text-xs font-semibold">{artist.artworksCount} 作品</span>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-1.5 text-gray-400 dark:text-gray-500 text-[11px]">
            <Calendar className="w-3 h-3" />
            <span>{new Date(artist.createdAt).toLocaleDateString('zh-CN')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ArtistCard
