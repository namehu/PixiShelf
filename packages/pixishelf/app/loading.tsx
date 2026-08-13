import { PageContainer } from '@/components/layout/page-container'
import { PageState } from '@/components/layout/page-state'

export default function Loading() {
  return (
    <main className="flex min-h-dvh items-center py-12">
      <PageContainer size="reading">
        <PageState
          variant="loading"
          headingLevel="h1"
          title="正在整理作品"
          description="请稍候，PixiShelf 正在准备当前内容。"
        />
      </PageContainer>
    </main>
  )
}
