import { getSeriesList } from '@/services/series-service'
import Link from 'next/link'
import Image from 'next/image'
import { Card, CardContent } from '@/components/ui/card'
import PNav from '@/components/layout/PNav'

export const metadata = {
  title: '系列列表 - PixiShelf'
}

export default async function SeriesListPage() {
  const { items } = await getSeriesList({ page: 1, pageSize: 100 })

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* 1. 顶部导航栏集成搜索框 */}
      <PNav border={false}>
        <h1 className="text-3xl font-bold">系列列表</h1>
        {/* <SearchBox
          value={searchQuery}
          onSearch={(query: string) => updateParams('search', query.trim() || null)}
          className="w-full shadow-sm"
        /> */}
      </PNav>
      <main className="mx-auto pb-10 px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {items.map((item: any) => (
            <Link href={`/series/${item.id}`} key={item.id} className="group">
              <Card className="overflow-hidden transition-all hover:shadow-lg border-none bg-transparent">
                <div className="aspect-[3/4] relative bg-muted rounded-lg overflow-hidden">
                  {item.coverImageUrl ? (
                    <Image
                      src={item.coverImageUrl}
                      alt={item.title}
                      width={0}
                      height={0}
                      sizes="100vw"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground bg-gray-100">
                      No Cover
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2 bg-black/60 text-white px-2 py-1 text-xs rounded-full">
                    {item.artworkCount} 作品
                  </div>
                </div>
                <CardContent className="p-3 pl-0">
                  <h3 className="font-semibold truncate text-lg" title={item.title}>
                    {item.title}
                  </h3>
                  <p className="text-xs text-muted-foreground truncate">{item.updatedAt.toLocaleDateString()}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
          {items.length === 0 && <div className="col-span-full text-center text-muted-foreground">暂无系列</div>}
        </div>
      </main>
    </div>
  )
}
