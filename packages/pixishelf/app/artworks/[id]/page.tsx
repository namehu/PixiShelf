import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLinkIcon } from 'lucide-react'
import z from 'zod'
import { ArtistAvatar } from '@/components/artwork/artist-avatar'
import { PageContainer } from '@/components/layout/page-container'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { getArtworkById } from '@/services/artwork-service'
import ArtworkDes from './_components/artwork-des'
import NavHead from './_components/nav-head'
import { ArtworkMediaSection } from './_components/artwork-media-section'
import { ArtworkMediaViewProvider } from './_components/artwork-media-view-context'
import CreatorTimeline from './_components/creator-timeline'
import SeriesNav from './_components/series-nav'
import TagArea from './_components/tag-area'

export default async function ArtworkDetailPage({ params }: PageProps<'/artworks/[id]'>) {
  const { id } = await params
  const data = await getArtworkById(z.coerce.number().parse(id))

  if (!data) {
    notFound()
  }

  const creators = data.creators ?? []

  return (
    <div className="min-h-dvh bg-background">
      <ArtworkMediaViewProvider>
        <NavHead data={data} id={id} />

        <main className="mx-auto w-full max-w-reading py-6 sm:py-8">
          <article className="max-w-full overflow-hidden">
            <PageContainer size="reading">
              <header className="mb-6 flex flex-col gap-4">
                <PrivacySensitiveText
                  as="h1"
                  className="break-words text-2xl leading-tight font-semibold tracking-[-0.025em] text-foreground sm:text-3xl lg:text-4xl"
                >
                  {data.title}
                </PrivacySensitiveText>

                <div className="flex flex-wrap items-center gap-3">
                  {creators.map(({ id: artistId, name: artistName, avatar: artistAvatar, kind, pixivUserId }) => (
                    <div key={artistId} className="flex min-w-0 max-w-full items-center gap-1">
                      <Link
                        href={`/artists/${artistId}`}
                        className="group -ml-1 flex min-h-11 min-w-0 items-center gap-2 rounded-full p-1 pr-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <ArtistAvatar src={artistAvatar} name={artistName} size={10} className="shrink-0" />
                        <PrivacySensitiveText className="min-w-0 truncate text-base font-medium text-primary underline-offset-4 group-hover:underline sm:text-lg">
                          {kind === 'GROUP' ? '社团：' : ''}
                          {artistName}
                        </PrivacySensitiveText>
                      </Link>
                      {pixivUserId && (
                        <a
                          href={`https://www.pixiv.net/users/${pixivUserId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="在 Pixiv 查看该作者主页（新标签页）"
                          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          Pixiv 主页
                          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                          <span className="sr-only">（新标签页）</span>
                        </a>
                      )}
                    </div>
                  ))}

                  {data.externalId && (
                    <a
                      href={`https://www.pixiv.net/artworks/${data.externalId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="在 Pixiv 查看该作品（新标签页）"
                      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      Pixiv 原作
                      <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">（新标签页）</span>
                    </a>
                  )}
                </div>
              </header>

              {!!data.tags.length && (
                <div className="mb-6">
                  <TagArea tags={data.tags} />
                </div>
              )}
            </PageContainer>

            <div id={`artwork-media-start-${data.id}`} aria-hidden="true" className="h-px" />
            <ArtworkMediaSection images={data.images} artworkId={data.id} />
            <PageContainer size="reading">
              <ArtworkDes description={data.description} className="mt-8" />
              {data.series.map((series) => (
                <SeriesNav key={series.id} series={series} />
              ))}
              <CreatorTimeline creators={creators} artworkId={data.id} />
            </PageContainer>
          </article>
        </main>
      </ArtworkMediaViewProvider>
    </div>
  )
}
