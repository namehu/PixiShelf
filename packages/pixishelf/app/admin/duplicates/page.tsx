import type { Metadata } from 'next'
import { DuplicateCheckPage } from './_components/duplicate-check-page'

export const metadata: Metadata = {
  title: '检查重复 - PixiShelf Admin',
  description: '检查同艺术家作品中的相同内容并跟踪检测进度'
}

export default async function DuplicatesPage({
  searchParams
}: {
  searchParams: Promise<{ artistId?: string | string[]; runId?: string | string[]; operationId?: string | string[] }>
}) {
  const params = await searchParams
  const artistId = typeof params.artistId === 'string' && /^\d+$/.test(params.artistId) ? Number(params.artistId) : null
  const runId = typeof params.runId === 'string' && params.runId.trim().length <= 128 ? params.runId.trim() : null
  const operationId =
    typeof params.operationId === 'string' && params.operationId.trim().length <= 128 ? params.operationId.trim() : null
  return (
    <DuplicateCheckPage
      artistId={artistId && Number.isSafeInteger(artistId) ? artistId : null}
      runId={runId || null}
      operationId={operationId || null}
    />
  )
}
