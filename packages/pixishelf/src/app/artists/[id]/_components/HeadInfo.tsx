import { ChevronLeft, Calendar, Image as ImageIcon, ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, memo } from 'react'
import { ArtistAvatar } from '@/components/artwork/ArtistAvatar'
import { ArtistResponseDto } from '@/schemas/artist.dto'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface IHeadInfoProps {
  artist: ArtistResponseDto
}

const Component: FC<IHeadInfoProps> = (props) => {
  const { artist } = props
  const router = useRouter()

  return (
    <div className="bg-background relative mb-8">
      {/* 顶部 Banner 区域 */}
      <div className="relative h-48 md:h-64 w-full overflow-hidden bg-muted">
        {/* 返回按钮 */}
        <div className="absolute top-4 left-4 z-20">
          <Button
            variant="secondary"
            size="sm"
            className="backdrop-blur-md bg-background/30 hover:bg-background/50 border-transparent text-white"
            onClick={() => router.back()}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            返回
          </Button>
        </div>

        {/* Banner 图片 */}
        {artist.backgroundImg ? (
          <div className="w-full h-full relative">
            <img
              src={artist.backgroundImg}
              alt={`${artist.name} banner`}
              className="w-full h-full object-cover"
              loading="eager"
            />
            {/* 渐变遮罩，保证文字/按钮可见性 */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
          </div>
        ) : (
          /* 默认 Banner 图案 */
          <div className="w-full h-full bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500 relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:20px_20px]" />
          </div>
        )}
      </div>

      {/* 个人信息区域 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative -mt-16 sm:-mt-20 mb-6">
          <div className="flex flex-col md:flex-row gap-6 items-start">
            {/* 头像 */}
            <div className="relative group">
              <div className="rounded-full p-1 bg-background shadow-xl">
                <ArtistAvatar
                  src={artist.avatar}
                  name={artist.name}
                  size={32}
                  className="border-4 border-background w-32 h-32 sm:w-40 sm:h-40"
                />
              </div>
            </div>

            {/* 文本信息 */}
            <div className="flex-1 pt-2 md:pt-20 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold text-foreground tracking-tight">{artist.name}</h1>
                  {artist.userId && (
                    <a
                      href={`https://www.pixiv.net/users/${artist.userId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-muted-foreground font-medium text-lg hover:text-primary transition-colors w-fit mt-1"
                      title="在 Pixiv 查看"
                    >
                      @{artist.userId}
                      <ExternalLink className="w-4 h-4 opacity-70" />
                    </a>
                  )}
                </div>

                {/* 统计 Badge */}
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="px-3 py-1.5 text-sm font-normal gap-1.5">
                    <ImageIcon className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-foreground">{artist.artworksCount}</span> 作品
                  </Badge>
                  <Badge variant="outline" className="px-3 py-1.5 text-sm font-normal gap-1.5 bg-background">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                    加入于 {new Date(artist.createdAt).toLocaleDateString('zh-CN')}
                  </Badge>
                </div>
              </div>

              {/* 简介 */}
              {artist.bio && (
                <div className="max-w-3xl">
                  <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">{artist.bio}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const HeadInfo = memo(Component)
export default HeadInfo
