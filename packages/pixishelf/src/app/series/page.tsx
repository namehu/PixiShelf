
import { getSeriesList } from '@/services/series-service'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'

export const metadata = {
  title: '系列列表 - PixiShelf'
}

export default async function SeriesListPage() {
  const { items } = await getSeriesList({ page: 1, pageSize: 100 })

  return (
    <div className="container mx-auto p-4 space-y-6 pt-16">
      <h1 className="text-3xl font-bold">系列列表</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
        {items.map((item: any) => (
          <Link href={`/series/${item.id}`} key={item.id} className="group">
            <Card className="overflow-hidden transition-all hover:shadow-lg border-none bg-transparent">
              <div className="aspect-[3/4] relative bg-muted rounded-lg overflow-hidden">
                {item.coverImageUrl ? (
                   <img src={item.coverImageUrl} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground bg-gray-100">No Cover</div>
                )}
                <div className="absolute bottom-2 right-2 bg-black/60 text-white px-2 py-1 text-xs rounded-full">
                  {item.artworkCount} 作品
                </div>
              </div>
              <CardContent className="p-3 pl-0">
                <h3 className="font-semibold truncate text-lg" title={item.title}>{item.title}</h3>
                <p className="text-xs text-muted-foreground truncate">{item.updatedAt.toLocaleDateString()}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
        {items.length === 0 && <div className="col-span-full text-center text-muted-foreground">暂无系列</div>}
      </div>
    </div>
  )
}
