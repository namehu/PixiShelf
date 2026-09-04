import Link from 'next/link'
import Image from 'next/image'
import { CalendarIcon, ImagesIcon } from 'lucide-react'
import type { ArtistResponseDto } from '@/schemas/artist.dto'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

interface ArtistCardProps {
  artist: ArtistResponseDto
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function ArtistCard({ artist }: ArtistCardProps) {
  const href = `/artists/${artist.id}`
  const initials = getInitials(artist.name)

  return (
    <article className="group min-w-0">
      <Link
        href={href}
        aria-label={`查看艺术家：${artist.name}`}
        className="relative block aspect-[16/9] overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {artist.backgroundImg ? (
          <Image
            src={artist.backgroundImg}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.02]"
          />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(135deg,var(--muted),color-mix(in_srgb,var(--primary)_12%,var(--background)))]">
            <span
              className="font-display absolute right-4 bottom-0 text-7xl font-semibold text-primary/10"
              aria-hidden="true"
            >
              {initials.charAt(0)}
            </span>
          </div>
        )}
        <div
          className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-foreground/35 to-transparent"
          aria-hidden="true"
        />
      </Link>

      <div className="relative -mt-7 flex min-w-0 items-end gap-3 px-3">
        <Avatar className="size-14 border-2 border-background bg-background shadow-surface">
          <AvatarImage src={artist.avatar} alt="" className="object-cover" />
          <AvatarFallback className="bg-primary/10 font-semibold text-primary">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 pb-0.5">
          <PrivacySensitiveText as="h2" className="truncate text-sm font-semibold text-foreground">
            <Link href={href} className="outline-none hover:text-primary focus-visible:text-primary">
              {artist.name}
            </Link>
          </PrivacySensitiveText>
          {artist.username && (
            <PrivacySensitiveText as="p" className="truncate text-xs text-muted-foreground">
              @{artist.username}
            </PrivacySensitiveText>
          )}
        </div>
      </div>

      <div className="font-utility mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ImagesIcon className="size-3.5" aria-hidden="true" />
          {artist.artworksCount} 件作品
        </span>
        {artist.createdAt && (
          <span className="inline-flex items-center gap-1.5">
            <CalendarIcon className="size-3.5" aria-hidden="true" />
            {new Date(artist.createdAt).toLocaleDateString('zh-CN')}
          </span>
        )}
      </div>
    </article>
  )
}

export default ArtistCard
