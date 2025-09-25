'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, ArtistCard } from '@/components/ui'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/lib/constants'
import { ArtistsResponse } from '@/types'
import { UsersIcon } from 'lucide-react'

interface RecentArtistsProps {
  data: ArtistsResponse
  error?: string | null
}

/**
 * 热门艺术家展示组件
 */
export default function RecentArtists({ data, error }: RecentArtistsProps) {
  const router = useRouter()

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">热门艺术家</h3>
          <p className="text-gray-600">发现才华横溢的艺术家们</p>
        </div>
        <Link href={ROUTES.ARTISTS}>
          <Button variant="ghost" className="text-blue-600 hover:text-blue-700">
            查看全部 →
          </Button>
        </Link>
      </div>

      {error ? (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      ) : data?.items?.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.items.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} onClick={() => router.push(`/artists/${artist.id}`)} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-12 text-center">
            <UsersIcon size={48} className="text-gray-300 mx-auto mb-4"></UsersIcon>
            <h3 className="text-lg font-medium text-gray-900 mb-2">暂无艺术家</h3>
            <p className="text-gray-600 mb-4">还没有任何艺术家，快去发现精彩内容吧！</p>
            <Link href={ROUTES.ARTISTS}>
              <Button>浏览艺术家</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
