import { getSeriesList } from '@/services/series-service'
import PNav from '@/components/layout/PNav'
import SeriesCard from './_components/SeriesCard'

export const metadata = {
  title: '系列列表 - PixiShelf'
}

export default async function SeriesListPage() {
  const { items } = await getSeriesList({ page: 1, pageSize: 100 })

  return (
    <div className="min-h-screen bg-gray-50">
      <PNav border={false}>
        <h1 className="text-3xl font-bold">系列列表</h1>
      </PNav>
      <main className="max-w-7xl mx-auto pb-10 px-4">
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
