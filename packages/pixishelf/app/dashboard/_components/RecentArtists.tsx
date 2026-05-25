'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/lib/constants'
import { UsersIcon, ArrowRight, Sparkles } from 'lucide-react'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import type { ArtistResponseDto } from '@/schemas/artist.dto'

interface RecentArtworkPreview {
  id: number
  title: string
  coverUrl: string
}

interface DashboardArtistItem extends ArtistResponseDto {
  recentArtworks: RecentArtworkPreview[]
}

interface RecentArtistsProps {
  data: DashboardArtistItem[]
  error?: string | null
}

function CompactArtistCard({ artist, onClick }: { artist: DashboardArtistItem; onClick: () => void }) {
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
      onClick={onClick}
      className="group relative rounded-xl border bg-card text-card-foreground shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer w-[260px] overflow-hidden hover:-translate-y-1"
    >
      <div className="grid grid-cols-3 gap-1 p-2 bg-muted/30">
        {artist.recentArtworks.length > 0 ? (
          artist.recentArtworks.slice(0, 3).map((artwork) => (
            <Link
              key={artwork.id}
              href={`/artworks/${artwork.id}`}
              onClick={(event) => event.stopPropagation()}
              className="relative aspect-square overflow-hidden rounded-md bg-muted"
              title={artwork.title}
            >
              {artwork.coverUrl ? (
                <Image
                  src={artwork.coverUrl}
                  alt={artwork.title}
                  fill
                  sizes="120px"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="size-full bg-gray-100" />
              )}
            </Link>
          ))
        ) : (
          <div className="col-span-3 aspect-[3/1] rounded-md bg-gray-100 flex items-center justify-center text-xs text-muted-foreground">
            暂无最近作品
          </div>
        )}
      </div>

      <div className="p-3 flex items-start gap-3">
        <Avatar className="size-12 shrink-0 group-hover:scale-105 transition-transform duration-200">
          <AvatarImage src={artist.avatar} alt={artist.name} />
          <AvatarFallback className="text-sm bg-primary/10 text-primary font-medium">
            {getInitials(artist.name)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm truncate" title={artist.name}>
            {artist.name}
          </h3>
          {artist.username && <p className="text-xs text-muted-foreground truncate">@{artist.username}</p>}
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px] h-5 px-2 bg-secondary/50">
              {artist.artworksCount} 作品
            </Badge>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 热门艺术家展示组件
 */
export default function RecentArtists({ data, error }: RecentArtistsProps) {
  const router = useRouter()

  if (error) {
    return (
      <div className="mb-8">
        <h3 className="text-2xl font-bold text-gray-900 mb-6">发现艺术家</h3>
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data.length) {
    return (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">随机发现艺术家</h3>
            <p className="text-gray-600">每次都会看到不一样的创作者和最近作品</p>
          </div>
        </div>
        <Card>
          <CardContent className="p-12 text-center">
            <UsersIcon size={48} className="text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">暂无艺术家</h3>
            <p className="text-gray-600 mb-4">还没有任何艺术家，快去发现精彩内容吧！</p>
            <Link href={ROUTES.ARTISTS}>
              <Button>浏览艺术家</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
            <Sparkles className="size-6 text-amber-500" />
            热门艺术家
          </h3>
          <p className="text-gray-600 text-sm">热门艺术家，最新作品预览</p>
        </div>
        <Link
          href={ROUTES.ARTISTS}
          className="group flex items-center text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
        >
          查看全部
          <ArrowRight className="ml-1 size-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </div>

      <ScrollArea className="w-full whitespace-nowrap rounded-md">
        <div className="flex w-max space-x-4 pb-4 px-1">
          {data.map((artist) => (
            <CompactArtistCard key={artist.id} artist={artist} onClick={() => router.push(`/artists/${artist.id}`)} />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  )
}
