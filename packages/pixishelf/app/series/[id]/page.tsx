import { notFound } from 'next/navigation'
import { LayersIcon } from 'lucide-react'
import { getSeriesDetail } from '@/services/series-service'
import ArtworkCard from '@/components/artwork/artwork-card'
import MediaThumbnail from '@/components/media/media-thumbnail'
import PageToolbar from '@/components/layout/page-toolbar'
import PageBackButton from '@/components/layout/page-back-button'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { PageState } from '@/components/layout/page-state'
import { SectionHeader } from '@/components/layout/section-header'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SeriesDetailPage({ params }: PageProps) {
  const { id } = await params
  const seriesId = Number(id)
  if (isNaN(seriesId)) notFound()

  const series = await getSeriesDetail(seriesId)
  if (!series) notFound()

  return (
    <div className="min-h-dvh bg-background">
      <PageToolbar
        containerSize="gallery"
        leading={<PageBackButton fallbackHref="/series" label="返回系列列表" />}
        title={<span className="line-clamp-1 text-sm font-semibold">{series.title}</span>}
      />

      <PageContainer as="main" size="gallery" className="flex flex-col gap-9 py-6 sm:py-8">
        <div className="grid gap-6 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start lg:grid-cols-[12rem_minmax(0,1fr)]">
          <div className="aspect-[3/4] overflow-hidden rounded-lg bg-muted">
            <MediaThumbnail
              media={series.coverImageUrl ? { path: series.coverImageUrl, mediaType: 'image' } : null}
              alt={series.title}
              width={384}
              height={512}
              sizes="(max-width: 640px) 100vw, 12rem"
              className="size-full object-cover"
            />
          </div>
          <PageHeader
            className="h-full"
            eyebrow="系列档案"
            title={series.title}
            description={series.description || '这个系列暂时没有描述。'}
            metadata={`${series.artworks.length} 件作品 · ${series.updatedAt.toLocaleDateString('zh-CN')} 更新`}
          />
        </div>

        <section className="flex flex-col gap-6">
          <SectionHeader title="作品顺序" description="按系列中保存的顺序浏览。" />
          {series.artworks.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {series.artworks.map((artwork: any, index: number) => (
                <div key={artwork.id} className="relative">
                  <span className="font-utility pointer-events-none absolute top-2 left-2 z-10 flex size-6 items-center justify-center rounded-full bg-foreground/70 text-xs text-background">
                    {index + 1}
                  </span>
                  <ArtworkCard artwork={artwork} />
                </div>
              ))}
            </div>
          ) : (
            <PageState
              variant="empty"
              compact
              headingLevel="h3"
              icon={<LayersIcon aria-hidden="true" />}
              title="系列中暂无作品"
              description="在管理中心为这个系列添加作品。"
            />
          )}
        </section>
      </PageContainer>
    </div>
  )
}
