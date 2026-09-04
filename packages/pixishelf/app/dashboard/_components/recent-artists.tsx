'use client'

import Link from 'next/link'
import { ArrowRightIcon, UsersIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { PageState } from '@/components/layout/page-state'
import { SectionHeader } from '@/components/layout/section-header'
import MediaThumbnail from '@/components/media/media-thumbnail'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { ROUTES } from '@/lib/constants'
import type { ArtistResponseDto } from '@/schemas/artist.dto'

interface RecentArtworkPreview {
  id: number
  title: string
  coverUrl: string | null
  coverMediaType: 'image' | 'video' | null
}

interface DashboardArtistItem extends ArtistResponseDto {
  recentArtworks: RecentArtworkPreview[]
}

interface RecentArtistsProps {
  data: DashboardArtistItem[]
  error?: string | null
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function CompactArtistCard({ artist }: { artist: DashboardArtistItem }) {
  return (
    <article className="w-[17.5rem] shrink-0 overflow-hidden rounded-surface border border-border bg-surface-raised">
      <div className="grid grid-cols-3 gap-1 bg-surface-muted p-1">
        {artist.recentArtworks.length > 0 ? (
          artist.recentArtworks.slice(0, 3).map((artwork) => (
            <Link
              key={artwork.id}
              href={`/artworks/${artwork.id}`}
              aria-label={`查看作品：${artwork.title}`}
              className="group relative aspect-square overflow-hidden rounded-sm bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
            >
              <MediaThumbnail
                media={
                  artwork.coverUrl
                    ? { path: artwork.coverUrl, mediaType: artwork.coverMediaType }
                    : { path: null, mediaType: artwork.coverMediaType }
                }
                alt={artwork.title}
                fill
                loading="lazy"
                sizes="96px"
                className="object-cover transition-transform duration-(--motion-base) group-hover:scale-[1.02]"
              />
            </Link>
          ))
        ) : (
          <div className="col-span-3 flex aspect-[3/1] items-center justify-center text-xs text-muted-foreground">
            暂无最近作品
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 p-3">
        <Avatar className="size-11 shrink-0">
          <AvatarImage src={artist.avatar} alt={artist.name} loading="lazy" />
          <AvatarFallback className="bg-accent text-sm font-medium text-accent-foreground">
            <PrivacySensitiveText>{getInitials(artist.name)}</PrivacySensitiveText>
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <Link
            href={`/artists/${artist.id}`}
            className="block truncate rounded-sm text-sm font-semibold text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <PrivacySensitiveText>{artist.name}</PrivacySensitiveText>
          </Link>
          {artist.username && (
            <PrivacySensitiveText as="p" className="truncate text-xs text-muted-foreground">
              @{artist.username}
            </PrivacySensitiveText>
          )}
        </div>

        <Badge variant="secondary" className="font-utility shrink-0 font-normal">
          {artist.artworksCount}
        </Badge>
      </div>
    </article>
  )
}

export default function RecentArtists({ data, error }: RecentArtistsProps) {
  return (
    <section aria-labelledby="dashboard-artists-heading" className="mb-12">
      <SectionHeader
        className="mb-5"
        title={<span id="dashboard-artists-heading">热门艺术家</span>}
        description="从活跃收藏中快速回到熟悉的创作者。"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={ROUTES.ARTISTS}>
              查看全部
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      {error ? (
        <PageState variant="error" compact headingLevel="h3" title="艺术家加载失败" description={error} />
      ) : data.length === 0 ? (
        <PageState
          variant="empty"
          compact
          headingLevel="h3"
          title="暂无艺术家"
          description="导入作品后，这里会展示活跃艺术家与最近作品。"
          icon={<UsersIcon aria-hidden="true" />}
          action={
            <Button asChild variant="outline">
              <Link href={ROUTES.ARTISTS}>浏览艺术家</Link>
            </Button>
          }
        />
      ) : (
        <ScrollArea className="w-full whitespace-nowrap">
          <div className="flex w-max gap-4 pb-4">
            {data.map((artist) => (
              <CompactArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}
    </section>
  )
}
