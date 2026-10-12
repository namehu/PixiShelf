import Link from 'next/link'
import { Suspense } from 'react'
import { ArrowLeft } from 'lucide-react'
import { PageContainer } from '@/components/layout/page-container'
import { ArtistMergePage } from './_components/artist-merge-page'

export default function MergePage() {
  return (
    <PageContainer size="standard" className="flex flex-col gap-6 py-6 [&]:max-w-6xl">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/artists"
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          返回艺术家管理
        </Link>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold">合并艺术家</h1>
          <p className="text-sm text-muted-foreground">将同一创作者的作品、来源身份与归档绑定集中到一位艺术家。</p>
        </div>
      </div>
      <Suspense fallback={<p>正在读取合并记录…</p>}>
        <ArtistMergePage />
      </Suspense>
    </PageContainer>
  )
}
