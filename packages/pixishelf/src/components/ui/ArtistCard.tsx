import React from 'react'
import { Artist } from '@pixishelf/shared'
import { Card, CardContent } from '@/components/ui'
import { Avatar, AvatarFallback } from '@/components/ui'
import { Badge } from '@/components/ui'

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
    <Card
      className="cursor-pointer hover:shadow-lg transition-shadow duration-200 bg-white dark:bg-gray-800"
      onClick={onClick}
    >
      <CardContent className="p-6">
        <div className="flex items-center space-x-4">
          <Avatar className="h-12 w-12">
            <AvatarFallback className="bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
              {getInitials(artist.name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">{artist.name}</h3>

            {artist.username && <p className="text-sm text-gray-500 dark:text-gray-400 truncate">@{artist.username}</p>}

            {artist.bio && <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 line-clamp-2">{artist.bio}</p>}

            <div className="flex items-center justify-between mt-3">
              <Badge variant="secondary" className="text-xs">
                {artist.artworksCount} 作品
              </Badge>

              <span className="text-xs text-gray-400 dark:text-gray-500">
                {new Date(artist.createdAt).toLocaleDateString('zh-CN')}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default ArtistCard
