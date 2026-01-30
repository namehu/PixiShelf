import { getSeriesDetail } from '@/services/series-service'
import { notFound } from 'next/navigation'
import ArtworkCard from '@/components/artwork/ArtworkCard'
import Image from 'next/image'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function SeriesDetailPage({ params }: PageProps) {
  const { id } = await params
  const seriesId = Number(id)
  if (isNaN(seriesId)) notFound()

  const series = await getSeriesDetail(seriesId)
  if (!series) notFound()

  const artworks = series.artworks

  return (
    <div className="container mx-auto p-4 space-y-6 pt-16">
      <div className="flex flex-col md:flex-row gap-6 mb-8 bg-white p-6 rounded-lg shadow-sm">
        <div className="w-full md:w-48 aspect-[3/4] bg-muted rounded-lg overflow-hidden shrink-0">
          {series.coverImageUrl ? (
            <Image
              src={series.coverImageUrl}
              alt={series.title}
              width={0}
              height={0}
              sizes="100vw"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-400">No Cover</div>
          )}
        </div>
        <div className="flex-1 space-y-4">
          <h1 className="text-3xl font-bold">{series.title}</h1>
          <p className="text-muted-foreground whitespace-pre-wrap">{series.description || '暂无描述'}</p>
          <div className="text-sm text-muted-foreground">
            共 {series.artworks.length} 个作品 · 更新于 {series.updatedAt.toLocaleDateString()}
          </div>
        </div>
      </div>

      <h2 className="text-xl font-bold">作品列表</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {artworks.map((artwork: any, index: number) => (
          <div key={artwork.id} className="relative group">
            <div className="absolute top-2 left-2 z-10 bg-black/60 text-white w-6 h-6 flex items-center justify-center rounded-full text-xs">
              {index + 1}
            </div>
            <ArtworkCard artwork={artwork} />
          </div>
        ))}
      </div>
    </div>
  )
}
