import Link from 'next/link'
import { CalendarIcon, ExternalLinkIcon, ImagesIcon, ImageUpIcon } from 'lucide-react'
import { memo, type FC } from 'react'
import { ArtistAvatar } from '@/components/artwork/artist-avatar'
import type { ArtistResponseDto } from '@/schemas/artist.dto'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'

interface HeadInfoProps {
  artist: ArtistResponseDto
  immersiveHref?: string
}

const Component: FC<HeadInfoProps> = ({ artist, immersiveHref }) => (
  <section className="border-b border-border">
    <div className="relative h-44 overflow-hidden bg-muted sm:h-56 lg:h-64">
      {artist.backgroundImg ? (
        <img
          src={artist.backgroundImg}
          alt=""
          width={1600}
          height={400}
          className="size-full object-cover"
          loading="eager"
        />
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(120deg,var(--muted),color-mix(in_srgb,var(--primary)_14%,var(--background)))]" />
      )}
      <div
        className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background/55 to-transparent"
        aria-hidden="true"
      />
    </div>

    <PageContainer size="gallery" className="relative pb-7">
      <div className="-mt-10 mb-4 sm:-mt-14">
        <ArtistAvatar
          src={artist.avatar}
          name={artist.name}
          size={28}
          className="size-24 border-4 border-background bg-background shadow-surface sm:size-28"
        />
      </div>

      <PageHeader
        className="border-0 pb-0"
        eyebrow="艺术家档案"
        title={artist.name}
        description={artist.bio ? <p className="max-w-3xl whitespace-pre-wrap">{artist.bio}</p> : undefined}
        metadata={
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="inline-flex items-center gap-1.5">
              <ImagesIcon className="size-3.5" aria-hidden="true" />
              {artist.artworksCount} 件作品
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarIcon className="size-3.5" aria-hidden="true" />
              {new Date(artist.createdAt).toLocaleDateString('zh-CN')} 加入
            </span>
            {artist.pixivUserId && (
              <a
                href={`https://www.pixiv.net/users/${artist.pixivUserId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-primary outline-none hover:underline focus-visible:underline"
              >
                Pixiv @{artist.pixivUserId}
                <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        }
        actions={
          immersiveHref ? (
            <Button asChild>
              <Link href={immersiveHref}>
                <ImageUpIcon data-icon="inline-start" aria-hidden="true" />
                沉浸浏览
              </Link>
            </Button>
          ) : undefined
        }
      />
    </PageContainer>
  </section>
)

const HeadInfo = memo(Component)
export default HeadInfo
