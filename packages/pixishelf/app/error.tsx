'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { HomeIcon, RefreshCcwIcon } from 'lucide-react'
import { PageContainer } from '@/components/layout/page-container'
import { PageState } from '@/components/layout/page-state'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-dvh items-center py-12">
      <PageContainer size="reading">
        <PageState
          variant="error"
          headingLevel="h1"
          title="页面加载失败"
          description="当前内容暂时无法加载。请重试；如果问题持续出现，可保留下面的错误编号。"
          action={
            <>
              <Button size="lg" onClick={reset}>
                <RefreshCcwIcon aria-hidden="true" data-icon="inline-start" />
                重试
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/dashboard">
                  <HomeIcon aria-hidden="true" data-icon="inline-start" />
                  返回首页
                </Link>
              </Button>
            </>
          }
        />
        {error.digest && (
          <p className="font-utility mx-auto mt-4 w-fit rounded-md bg-muted px-3 py-1.5 text-xs text-muted-foreground select-all">
            Error ID: {error.digest}
          </p>
        )}
      </PageContainer>
    </main>
  )
}
