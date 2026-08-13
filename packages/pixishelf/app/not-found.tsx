'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon, FileQuestionIcon, HomeIcon } from 'lucide-react'
import { PageContainer } from '@/components/layout/page-container'
import { PageState } from '@/components/layout/page-state'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center py-12">
      <PageContainer size="reading">
        <PageState
          variant="empty"
          headingLevel="h1"
          icon={<FileQuestionIcon aria-hidden="true" />}
          title="没有找到这个页面"
          description="它可能已被移动或删除。你可以返回作品首页，或回到上一页继续浏览。"
          action={
            <>
              <Button asChild size="lg">
                <Link href="/dashboard">
                  <HomeIcon aria-hidden="true" data-icon="inline-start" />
                  返回首页
                </Link>
              </Button>
              <Button variant="outline" size="lg" onClick={() => window.history.back()}>
                <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
                返回上一页
              </Button>
            </>
          }
        />
      </PageContainer>
    </main>
  )
}
