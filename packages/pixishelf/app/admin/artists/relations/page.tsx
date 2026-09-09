import Link from 'next/link'
import { Suspense } from 'react'
import { CreatorReviewPage } from './_components/creator-review-page'
import { PageContainer } from '@/components/layout/page-container'

export default function CreatorRelationsPage() {
  return (
    <PageContainer size="workbench" className="flex flex-col gap-6 py-6">
      <Link href="/admin/artworks" className="text-sm underline underline-offset-4">
        返回作品管理
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">填写和纠正作品作者</h1>
        <p className="text-muted-foreground">
          让归档作品也能按作者浏览。先检查原网站保存的作者信息，看过结果后再保存。
        </p>
      </div>
      <Suspense fallback={<p>正在读取检查记录…</p>}>
        <CreatorReviewPage />
      </Suspense>
    </PageContainer>
  )
}
