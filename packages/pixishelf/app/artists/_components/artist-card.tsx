import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { ImageIcon, Calendar } from 'lucide-react'
import Image from 'next/image'
import type { ArtistResponseDto } from '@/schemas/artist.dto'

interface ArtistCardProps {
  artist: ArtistResponseDto
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

  // 生成伪随机渐变背景
  const getGradientBg = (id: number) => {
    const gradients = [
      'from-rose-100 via-purple-100 to-indigo-100 dark:from-rose-950/30 dark:via-purple-950/30 dark:to-indigo-950/30',
      'from-blue-100 via-cyan-100 to-teal-100 dark:from-blue-950/30 dark:via-cyan-950/30 dark:to-teal-950/30',
      'from-amber-100 via-orange-100 to-yellow-100 dark:from-amber-950/30 dark:via-orange-950/30 dark:to-yellow-950/30',
      'from-emerald-100 via-green-100 to-lime-100 dark:from-emerald-950/30 dark:via-green-950/30 dark:to-lime-950/30',
      'from-fuchsia-100 via-pink-100 to-rose-100 dark:from-fuchsia-950/30 dark:via-pink-950/30 dark:to-rose-950/30',
      'from-indigo-100 via-violet-100 to-purple-100 dark:from-indigo-950/30 dark:via-violet-950/30 dark:to-purple-950/30'
    ]
    return gradients[id % gradients.length]
  }

  return (
    <div
      className="group relative overflow-hidden border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-[0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-none transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.2)] dark:hover:border-gray-700 cursor-pointer rounded-xl"
      onClick={onClick}
    >
      {/* 顶部 Banner 区域 */}
      <div className="h-32 w-full overflow-hidden bg-gray-50 dark:bg-gray-800 relative">
        {artist.backgroundImg ? (
          <Image
            src={artist.backgroundImg}
            alt=""
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
        ) : (
          <div className={`absolute inset-0 bg-gradient-to-br ${getGradientBg(artist.id)}`}>
            {/* 装饰性的大字首字母 */}
            <span className="absolute -bottom-8 -right-4 text-9xl font-black opacity-[0.07] dark:opacity-[0.05] select-none pointer-events-none rotate-12 mix-blend-multiply dark:mix-blend-overlay font-serif">
              {getInitials(artist.name).charAt(0)}
            </span>

            {/* 细微的噪点纹理，增加质感 */}
            <div className="absolute inset-0 opacity-[0.4] mix-blend-soft-light bg-[url('/patterns/noise.png')] bg-repeat" />

            {/* 装饰性网格 */}
            <div className="absolute inset-0 bg-[url('/patterns/grid.svg')] opacity-[0.03]" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </div>

      {/* 内容区域 */}
      <div className="px-5 pb-5">
        <div className="flex justify-between items-start -mt-12 mb-3 relative z-10">
          {/* 头像 */}
          <Avatar className="size-20 border-[4px] border-white dark:border-gray-900 shadow-md bg-white dark:bg-gray-900">
            <AvatarImage src={artist.avatar} className="object-cover" />
            <AvatarFallback className="bg-primary/5 text-primary text-xl font-bold">
              {getInitials(artist.name)}
            </AvatarFallback>
          </Avatar>
        </div>

        {/* 文本信息 */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <h3 className="text-[17px] font-bold text-gray-900 dark:text-white truncate leading-tight group-hover:text-primary transition-colors">
              {artist.name}
            </h3>

            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400 group-hover:bg-primary/5 group-hover:text-primary transition-colors">
              <ImageIcon className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold">{artist.artworksCount} 作品</span>
            </div>
          </div>

          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 text-xs">
              {artist.username && (
                <span className="text-gray-400 dark:text-gray-500 font-medium truncate max-w-[120px]">
                  @{artist.username}
                </span>
              )}
              <span className="w-0.5 h-0.5 rounded-full bg-gray-300 dark:bg-gray-600" />
            </div>

            {artist.createdAt && (
              <div className="flex items-center gap-1.5 text-gray-400 dark:text-gray-500 text-[11px]">
                <Calendar className="w-3 h-3" />
                <span>{new Date(artist.createdAt).toLocaleDateString('zh-CN')}</span>
              </div>
            )}
          </div>
        </div>

        {/* 底部数据 */}
      </div>
    </div>
  )
}

export default ArtistCard
