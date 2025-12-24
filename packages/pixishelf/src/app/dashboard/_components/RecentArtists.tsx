'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/lib/constants'
import { UsersIcon, ArrowRight } from 'lucide-react'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ArtistResponseDto } from '@/schemas/artist.dto'

interface RecentArtistsProps {
  data: ArtistResponseDto[]
  error?: string | null
}

function CompactArtistCard({ artist, onClick }: { artist: ArtistResponseDto; onClick: () => void }) {
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
      className="group relative flex flex-col items-center p-4 rounded-xl border bg-card text-card-foreground shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer w-[180px] hover:-translate-y-1"
    >
      <Avatar className="size-20 mb-3 group-hover:scale-105 transition-transform duration-200">
        <AvatarImage src={artist.avatar} alt={artist.name} />
        <AvatarFallback className="text-lg bg-primary/10 text-primary font-medium">
          {getInitials(artist.name)}
        </AvatarFallback>
      </Avatar>

      <div className="text-center w-full space-y-1">
        <h3 className="font-semibold text-sm truncate w-full px-2" title={artist.name}>
          {artist.name}
        </h3>
        {artist.username && <p className="text-xs text-muted-foreground truncate w-full px-2">@{artist.username}</p>}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Badge variant="secondary" className="text-[10px] h-5 px-2 bg-secondary/50">
          {artist.artworksCount} 作品
        </Badge>
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
        <h3 className="text-2xl font-bold text-gray-900 mb-6">热门艺术家</h3>
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
            <h3 className="text-2xl font-bold text-gray-900 mb-2">热门艺术家</h3>
            <p className="text-gray-600">发现才华横溢的艺术家们</p>
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
          <h3 className="text-2xl font-bold text-gray-900 mb-2">热门艺术家</h3>
          <p className="text-gray-600 text-sm">发现才华横溢的艺术家们</p>
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
