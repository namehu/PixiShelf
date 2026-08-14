import { LayersIcon } from 'lucide-react'
import { getSeriesList } from '@/services/series-service'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { PageState } from '@/components/layout/page-state'
import SeriesCard from './_components/series-card'

export const metadata = { title: '系列 - PixiShelf' }

export default async function SeriesListPage() {
  const { items } = await getSeriesList({ page: 1, pageSize: 100 })

  return (
    <PageContainer as="main" size="gallery" className="flex min-h-dvh flex-col gap-8 py-6 sm:py-8">
      <PageHeader
        eyebrow="顺序收藏"
        title="系列"
        description="按既定顺序整理和浏览同一主题下的作品。"
        metadata={`${items.length} 个系列`}
      />

      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {items.map((item: any, index: number) => (
            <SeriesCard key={item.id} series={item} priority={index < 6} />
          ))}
        </div>
      ) : (
        <PageState
          variant="empty"
          headingLevel="h2"
          icon={<LayersIcon aria-hidden="true" />}
          title="暂无系列"
          description="在管理中心创建系列并添加作品后，这里会显示顺序收藏。"
        />
      )}
    </PageContainer>
  )
}
