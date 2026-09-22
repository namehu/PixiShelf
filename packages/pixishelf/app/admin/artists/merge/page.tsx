import Link from 'next/link'
import { Suspense } from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { ArtistMergePage } from './_components/artist-merge-page'

export default function MergePage() {
  return (
    <PageContainer size="workbench" className="flex flex-col gap-6 py-6">
      <Link href="/admin/artists" className="text-sm underline underline-offset-4">
        返回艺术家管理
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">合并艺术家</h1>
        <p className="text-muted-foreground">
          将同一创作者的作品和归档绑定集中到一个艺术家。先选择保留方，再检查合并结果。
        </p>
      </div>
      <Suspense fallback={<p>正在读取合并记录…</p>}>
        <ArtistMergePage />
      </Suspense>
    </PageContainer>
  )
}
