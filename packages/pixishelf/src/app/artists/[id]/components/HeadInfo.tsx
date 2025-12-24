import { ChevronLeftIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, memo } from 'react'
import { ArtistAvatar } from '@/components/artwork/ArtistAvatar'
import { ArtistResponseDto } from '@/schemas/artist.dto'

interface IHeadInfoProps {
  artist: ArtistResponseDto
}

const Component: FC<IHeadInfoProps> = (props) => {
  const { artist } = props
  const router = useRouter()

  {
    /* 返回按钮 - 绝对定位在背景图上 */
  }
  return (
    <div>
      <div className="absolute top-4 left-4 z-20">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center px-3 py-2 text-white bg-black bg-opacity-50 hover:bg-opacity-70 rounded-lg transition-all backdrop-blur-sm"
        >
          <ChevronLeftIcon size={24} />
          返回
        </button>
      </div>

      {/* 艺术家背景图和信息头部 */}
      <div className="relative">
        {/* 背景图容器 */}
        <div className="relative h-80 md:h-96 overflow-hidden ">
          {/* 背景图 */}
          {artist.backgroundImg ? (
            <div className="absolute inset-0">
              <div className="relative w-full h-full">
                <img
                  src={artist.backgroundImg}
                  alt={`${artist.name} 背景图`}
                  className="w-full h-full object-cover transition-opacity duration-300"
                  loading="eager"
                />
                <div
                  className="absolute inset-0 w-full h-full bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500"
                  style={{ display: 'none' }}
                />
              </div>
              {/* 渐变遮罩 */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            </div>
          ) : (
            /* 默认背景 */
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500">
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />
            </div>
          )}

          {/* 艺术家信息覆盖层 */}
          <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8">
            <div className="flex flex-col md:flex-row items-start md:items-end gap-4">
              {/* 头像和基本信息 */}
              <div className="flex gap-4 items-end">
                <div className="relative">
                  <ArtistAvatar src={artist.avatar} size={16} className="border-4 border-white shadow-lg" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-white mb-2 drop-shadow-lg">{artist.name}</p>
                  {artist.userId && <p className="text-xl text-white/90 drop-shadow">@{artist.userId}</p>}
                </div>
              </div>

              {/* 统计信息 */}
              <div className="flex flex-wrap gap-4 md:ml-auto">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v12a4 4 0 004 4h4a2 2 0 002-2V5z"
                    />
                  </svg>
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-white/20 text-white backdrop-blur-sm">
                    {artist.artworksCount} 作品
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="text-sm text-white/80 bg-white/20 px-3 py-1 rounded-full backdrop-blur-sm">
                    加入于 {new Date(artist.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
              </div>
            </div>

            {/* 艺术家简介 - 在背景图下方 */}
            {artist.bio && <p className="text-white leading-relaxed mt-4">{artist.bio}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

const HeadInfo = memo(Component)
export default HeadInfo
