import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import PageBackButton from '@/components/layout/page-back-button'
import { SourcePreviewReader } from '@/components/source-preview/source-preview-reader'
import { auth } from '@/lib/auth'

const OPAQUE_PREVIEW_ID = /^[A-Za-z0-9_-]{1,128}$/

export default async function SourcePreviewPage({
  searchParams
}: {
  searchParams: Promise<{ preview?: string | string[] }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  const { preview } = await searchParams
  if (typeof preview !== 'string' || !OPAQUE_PREVIEW_ID.test(preview)) notFound()
  if (!session?.user?.id) {
    redirect(`/login?redirect=${encodeURIComponent(`/source-preview?preview=${preview}`)}`)
  }

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-4xl items-center px-2 pt-[calc(0.5rem+env(safe-area-inset-top))] sm:px-4">
        <PageBackButton fallbackHref="/" label="返回上一页" />
      </div>
      <SourcePreviewReader previewId={preview} />
    </main>
  )
}
