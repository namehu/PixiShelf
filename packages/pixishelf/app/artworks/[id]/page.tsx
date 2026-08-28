import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLinkIcon } from 'lucide-react'
import z from 'zod'
import { ArtistAvatar } from '@/components/artwork/artist-avatar'
import { PageContainer } from '@/components/layout/page-container'
import { Button } from '@/components/ui/button'
import { getArtworkById } from '@/services/artwork-service'
import ArtworkDes from './_components/artwork-des'
import ArtworkImages from './_components/artwork-images'
import NavHead from './_components/nav-head'
import RelatedArtworks from './_components/related-artworks'
import SeriesNav from './_components/series-nav'
import TagArea from './_components/tag-area'

export default async function ArtworkDetailPage({ params }: PageProps<'/artworks/[id]'>) {
  const { id } = await params
  const data = await getArtworkById(z.coerce.number().parse(id))

  if (!data) {
    notFound()
  }

  const { id: artistId, name: artistName, avatar: artistAvatar } = data.artist ?? {}

  return (
    <div className="min-h-dvh bg-background">
      <NavHead data={data} id={id} />

      <main className="mx-auto w-full max-w-reading py-6 sm:py-8">
        <article className="max-w-full overflow-hidden">
          <PageContainer size="reading">
            <header className="mb-6 flex flex-col gap-4">
              <h1 className="break-words text-2xl leading-tight font-semibold tracking-[-0.025em] text-foreground sm:text-3xl lg:text-4xl">
                {data.title}
              </h1>

              <div className="flex flex-wrap items-center gap-3">
                {data.artist && (
                  <Link
                    href={`/artists/${artistId}`}
                    className="group -ml-1 flex min-h-11 min-w-0 items-center gap-2 rounded-full p-1 pr-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <ArtistAvatar src={artistAvatar} name={artistName} size={10} />
                    <span className="truncate text-base font-medium text-primary underline-offset-4 group-hover:underline sm:text-lg">
                      {artistName}
                    </span>
                  </Link>
                )}

                {data.externalId && (
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    className="h-9 rounded-full text-muted-foreground hover:border-primary/30 hover:bg-accent hover:text-accent-foreground"
                  >
                    <a
                      href={`https://www.pixiv.net/artworks/${data.externalId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="在 Pixiv 查看该作品"
                    >
                      <span className="text-xs font-semibold tracking-wide uppercase">Pixiv</span>
                      <span aria-hidden="true" className="mx-0.5 h-3 w-px bg-border" />
                      <span className="font-utility text-xs">{data.externalId}</span>
                      <ExternalLinkIcon data-icon="inline-end" aria-hidden="true" />
                    </a>
                  </Button>
                )}
              </div>
            </header>

            {!!data.tags.length && (
              <div className="mb-6">
                <TagArea tags={data.tags} />
              </div>
            )}
          </PageContainer>

          <ArtworkImages images={data.images} artworkId={data.id} />
          <PageContainer size="reading">
            <ArtworkDes description={data.description} className="mt-8" />
            {data.series.map((series) => (
              <SeriesNav key={series.id} series={series} />
            ))}
            {artistId && <RelatedArtworks artistId={artistId} currentArtworkId={data.id} />}
          </PageContainer>
        </article>
      </main>
    </div>
  )
}
