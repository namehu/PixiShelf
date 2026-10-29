import { getArchiveCoverage } from '@/services/archive/archive-coverage-service'
import { ArchiveCoverageFooter } from './_components/archive-coverage-footer'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLinkIcon, UserRoundIcon } from 'lucide-react'
import z from 'zod'
import { ArtistAvatar } from '@/components/artwork/artist-avatar'
import { PageContainer } from '@/components/layout/page-container'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { getArtworkReaderInitial } from '@/services/artwork-service/reader'
import { ArtworkReaderProvider } from '@/lib/reading/artwork-reader-provider'
import { getArtworkSourceLinks } from '@/services/artwork/source-links'
import ArtworkDes from './_components/artwork-des'
import { ArtworkSummaryProvider } from './_components/artwork-summary-context'
import NavHead from './_components/nav-head'
import { ArtworkMediaSection } from './_components/artwork-media-section'
import { ArtworkMediaViewProvider } from './_components/artwork-media-view-context'
import CreatorTimeline from './_components/creator-timeline'
import SeriesNav from './_components/series-nav'
import TagArea from './_components/tag-area'
import { ArtworkDetailControlsProvider } from './_components/artwork-detail-controls'

export default async function ArtworkDetailPage({ params, searchParams }: PageProps<'/artworks/[id]'>) {
  const { id } = await params
  const query = await searchParams
  const resumeOnEntry = query?.resume === '1'
  const mediaId = z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().safe().positive())
    .safeParse(query?.mediaId)
  const mediaIdOnEntry = query?.mediaId === undefined ? undefined : mediaId.success ? mediaId.data : null
  const initial = await getArtworkReaderInitial(z.coerce.number().parse(id))
  const data = initial?.artwork

  if (!data) {
    notFound()
  }

  const [sourceLinks, coverage] = await Promise.all([getArtworkSourceLinks(data.id), getArchiveCoverage(data.id)])
  const creators = data.creators ?? []

  return (
    <div className="min-h-dvh bg-background">
      <ArtworkMediaViewProvider key={data.id}>
        <ArtworkReaderProvider artworkId={data.id} initial={initial!}>
          <ArtworkSummaryProvider artworkId={data.id} suppressRecoveryNavigation={mediaIdOnEntry !== undefined}>
            <ArtworkDetailControlsProvider key={data.id} artworkId={data.id}>
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

                      {coverage?.partial ? (
                        <Badge variant="secondary">
                          部分归档 · {coverage.localCount}/{coverage.sourceTotal} 张
                        </Badge>
                      ) : null}
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
                                referrerPolicy="no-referrer"
                                title="Pixiv 作者主页"
                                aria-label="在 Pixiv 查看该作者主页（新标签页）"
                                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                              >
                                <UserRoundIcon className="size-4" aria-hidden="true" />
                              </a>
                            )}
                          </div>
                        ))}

                        {sourceLinks.map((source) => (
                          <a
                            key={source.id}
                            href={source.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            referrerPolicy="no-referrer"
                            title="在新标签页打开原站"
                            className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            <ExternalLinkIcon className="size-4" aria-hidden="true" />
                            <PrivacySensitiveText>{source.label}</PrivacySensitiveText>
                          </a>
                        ))}
                        {data.pixivArtworkId && (
                          <a
                            href={`https://www.pixiv.net/artworks/${data.pixivArtworkId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            referrerPolicy="no-referrer"
                            title="Pixiv 原作"
                            aria-label="在 Pixiv 查看该作品（新标签页）"
                            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            <ExternalLinkIcon className="size-4" aria-hidden="true" />
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
                  <ArtworkMediaSection
                    images={data.images}
                    artworkId={data.id}
                    resumeOnEntry={resumeOnEntry}
                    mediaIdOnEntry={mediaIdOnEntry}
                  />
                  <PageContainer size="reading" className="[&>:first-child]:mt-2">
                    {coverage?.partial ? (
                      <ArchiveCoverageFooter artworkId={data.id} initial={coverage} sourceLinks={sourceLinks} />
                    ) : null}
                    <ArtworkDes description={data.description} className="mt-8" />
                    {data.series.map((series) => (
                      <SeriesNav key={series.id} series={series} />
                    ))}
                    <CreatorTimeline creators={creators} artworkId={data.id} />
                  </PageContainer>
                </article>
              </main>
            </ArtworkDetailControlsProvider>
          </ArtworkSummaryProvider>
        </ArtworkReaderProvider>
      </ArtworkMediaViewProvider>
    </div>
  )
}
