import { getSeriesList } from '@/services/series-service'
import SeriesCard from './_components/SeriesCard'

export const metadata = {
  title: '系列列表 - PixiShelf'
}

export default async function SeriesListPage() {
  const { items } = await getSeriesList({ page: 1, pageSize: 100 })

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto py-8 px-4">
        <h1 className="mb-6 text-3xl font-bold">系列列表</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {items.map((item: any) => (
            <SeriesCard key={item.id} series={item} />
          ))}
          {items.length === 0 && <div className="col-span-full text-center text-muted-foreground">暂无系列</div>}
        </div>
      </main>
    </div>
  )
}
