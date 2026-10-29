'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { DownloadIcon, ExternalLinkIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTRPC } from '@/lib/trpc'
import type { ArchiveCoverage } from '@/services/archive/archive-coverage-service'
import type { ArtworkSourceLink } from '@/services/artwork/source-links'

export function ArchiveCoverageFooter({
  artworkId,
  initial,
  sourceLinks
}: {
  artworkId: number
  initial: NonNullable<ArchiveCoverage>
  sourceLinks: ArtworkSourceLink[]
}) {
  const trpc = useTRPC()
  const router = useRouter()
  const requestKey = useRef<string | null>(null)
  const coverage = useQuery(
    trpc.archive.getCoverage.queryOptions(
      { artworkId },
      {
        initialData: initial,
        refetchInterval: (query) => (query.state.data?.active ? 2_000 : false)
      }
    )
  )
  const complete = useMutation(
    trpc.archive.completeArtwork.mutationOptions({
      onSuccess: async () => {
        requestKey.current = null
        await coverage.refetch()
        toast.success('已加入补全队列，原有图片仍可阅读。')
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const data = coverage.data
  if (!data) return null
  const changed = data.revisionId !== initial.revisionId
  const taskHref = data.taskId
    ? `/admin/archive?taskId=${encodeURIComponent(data.taskId)}`
    : data.intakeItemId
      ? `/admin/archive/inbox?itemId=${encodeURIComponent(data.intakeItemId)}`
      : null
  return (
    <section aria-label="部分归档" className="my-6 flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{data.partial ? '部分归档' : '已补全'}</Badge>
        <span className="text-sm">
          本地 {data.localCount} / 原站 {data.sourceTotal ?? '未知'} 张
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        阅读进度按已下载的图片计算。补全会沿用原画质，保留已读记录和单图标记；完成后自动清理旧副本，过程需要临时存放完整作品的空间。
      </p>
      {data.error ? (
        <p role="alert" className="text-sm text-destructive">
          {data.error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {sourceLinks.map((source) => (
          <Button asChild variant="outline" key={source.id}>
            <a href={source.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
              <ExternalLinkIcon aria-hidden="true" />
              去原站预览
            </a>
          </Button>
        ))}
        {changed ? (
          <Button onClick={() => router.refresh()}>
            <RefreshCwIcon aria-hidden="true" />
            刷新查看全部
          </Button>
        ) : (
          <Button
            disabled={!data.canComplete || complete.isPending}
            onClick={() => {
              requestKey.current ??= crypto.randomUUID()
              complete.mutate({ artworkId, expectedRevisionId: data.revisionId, idempotencyKey: requestKey.current })
            }}
          >
            <DownloadIcon aria-hidden="true" />
            {complete.isPending ? '正在提交…' : data.active ? '正在补全' : '下载剩余图片'}
          </Button>
        )}
        {taskHref ? (
          <Button asChild variant="link">
            <Link href={taskHref}>查看补全任务</Link>
          </Button>
        ) : null}
      </div>
    </section>
  )
}
