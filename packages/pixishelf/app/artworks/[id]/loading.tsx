import { PageContainer } from '@/components/layout/page-container'
import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <PageContainer as="main" size="reading" className="py-8" aria-label="正在加载作品详情" aria-busy="true">
      <div className="mb-8 flex flex-col gap-4">
        <Skeleton className="h-9 w-4/5" />
        <Skeleton className="h-11 w-44 rounded-full" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-full" />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="aspect-[4/3] w-full rounded-md" />
        ))}
      </div>
    </PageContainer>
  )
}
