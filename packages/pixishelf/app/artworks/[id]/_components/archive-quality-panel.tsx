'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDownIcon, DownloadIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ArchiveQualityBadge } from '@/components/artwork/archive-quality-badge'
import { formatArchiveSourceSize } from '@/lib/archive-source-size'
import { archiveImageVersionReason } from '@/lib/archive-quality-reason'
import { archiveQualityAuditHref } from '@/lib/archive-quality-audit-navigation'

const REASON_BATCH_SIZE = 50

function groupPageReasons(pages: ReadonlyArray<{ index: number; reason: string }>) {
  const groups = new Map<string, { count: number; ranges: { start: number; end: number }[] }>()
  for (const page of [...pages].sort((a, b) => a.index - b.index)) {
    const reason = archiveImageVersionReason(page.reason)
    let group = groups.get(reason)
    if (!group) {
      group = { count: 0, ranges: [] }
      groups.set(reason, group)
    }
    const pageNumber = page.index + 1
    const lastRange = group.ranges.at(-1)
    if (lastRange && lastRange.end + 1 === pageNumber) {
      lastRange.end = pageNumber
    } else {
      group.ranges.push({ start: pageNumber, end: pageNumber })
    }
    group.count += 1
  }
  return Array.from(groups, ([reason, { count, ranges }]) => ({
    reason,
    count,
    pages: ranges.map(({ start, end }) => (start === end ? start : `${start}–${end}`)).join('、')
  }))
}

export function ArchiveQualityPanel({ artworkId }: { artworkId: number }) {
  const trpc = useTRPC()
  const router = useRouter()
  const [baseline, setBaseline] = useState<{ artworkId: number; revisionId: string | null }>({
    artworkId,
    revisionId: null
  })
  const request = useRef<{ revisionId: string; key: string } | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [reasonsOpen, setReasonsOpen] = useState(false)
  const [detailsOffset, setDetailsOffset] = useState(0)
  const query = useQuery(
    trpc.archive.getOriginalUpgrade.queryOptions(
      { artworkId },
      {
        refetchInterval: (state) => (state.state.data?.active ? 2_000 : false)
      }
    )
  )
  const { data } = query
  const hasUnconfirmedVersions = Boolean(data && (data.quality.unknownCount > 0 || !data.quality.verifiedAt))
  const details = useQuery(
    trpc.archive.getQualityDetails.queryOptions(
      { artworkId, offset: detailsOffset, limit: REASON_BATCH_SIZE },
      {
        enabled: detailsOpen && reasonsOpen && baseline.artworkId === artworkId && hasUnconfirmedVersions,
        staleTime: 0,
        placeholderData: keepPreviousData
      }
    )
  )
  const upgrade = useMutation(
    trpc.archive.upgradeOriginal.mutationOptions({
      onSuccess: async () => {
        request.current = null
        await query.refetch()
        toast.success('已提交原图下载任务，已保存的图片仍可阅读。')
      },
      onError: (error) => toast.error(error.message)
    })
  )
  const queriedRevisionId = data?.revisionId
  useEffect(() => {
    if (baseline.artworkId !== artworkId) {
      setDetailsOpen(false)
      setReasonsOpen(false)
      setDetailsOffset(0)
      request.current = null
    }
    if ((baseline.artworkId !== artworkId || baseline.revisionId === null) && queriedRevisionId) {
      setBaseline({ artworkId, revisionId: queriedRevisionId })
    }
  }, [artworkId, baseline.artworkId, baseline.revisionId, queriedRevisionId])
  if (!data) return null
  const changed =
    baseline.artworkId === artworkId && baseline.revisionId !== null && data.revisionId !== baseline.revisionId
  const taskHref = data.taskId
    ? `/admin/archive?taskId=${encodeURIComponent(data.taskId)}`
    : data.intakeItemId
      ? `/admin/archive/inbox?itemId=${encodeURIComponent(data.intakeItemId)}`
      : null
  const qualityHref = data.qualityTaskId ? `/admin/archive?taskId=${encodeURIComponent(data.qualityTaskId)}` : null
  const pageDetails = details.data
  const nextOffset = pageDetails?.nextOffset ?? null
  const batchStart = detailsOffset + 1
  const batchEnd = Math.min(detailsOffset + REASON_BATCH_SIZE, pageDetails?.total ?? 0)
  const { originalCount, displayCount, unknownCount, verifiedAt } = data.quality
  const confirmedVersions = [
    originalCount > 0 && `${originalCount} 张确认是原图`,
    displayCount > 0 && `${displayCount} 张是网页阅读版`
  ]
    .filter(Boolean)
    .join('，')
  return (
    <details
      className="group/versions"
      open={detailsOpen}
      onToggle={(event) => {
        if (event.target !== event.currentTarget) return
        const open = event.currentTarget.open
        setDetailsOpen(open)
        if (!open) setReasonsOpen(false)
      }}
    >
      <summary className="inline-flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-md pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        保存的图片
        <ArchiveQualityBadge quality={data.quality} compact />
        <ChevronDownIcon aria-hidden="true" className="size-4 group-open/versions:rotate-180" />
      </summary>
      {detailsOpen && baseline.artworkId === artworkId ? (
        <div className="mt-1 flex flex-col gap-4 rounded-md border px-3 py-4 sm:px-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm tabular-nums">
              {verifiedAt ? (
                <>
                  {confirmedVersions ? `${confirmedVersions}。` : null}
                  {unknownCount > 0
                    ? `${confirmedVersions ? '另有 ' : ''}${unknownCount} 张已保存，但从现有下载和发布记录无法确认是否为原图。`
                    : null}
                </>
              ) : (
                '图片已保存，目前还没有识别出图片版本。'
              )}
            </p>
            {verifiedAt && confirmedVersions ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {originalCount > 0 ? '原图是上传到原站的原始文件。' : null}
                {displayCount > 0 ? '网页阅读版是原站用于在线阅读的版本，可能经过缩小或压缩。' : null}
              </p>
            ) : null}
            {unknownCount === 0 || !verifiedAt ? (
              <p className="text-xs leading-relaxed text-muted-foreground">图片版本依据下载和发布记录判断。</p>
            ) : null}
          </div>
          <dl className="text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">原站整部大小</dt>
              <dd className="tabular-nums">{formatArchiveSourceSize(data.sourceSizeBytes)}</dd>
            </div>
          </dl>

          {hasUnconfirmedVersions ? (
            <details
              className="group/reasons"
              open={reasonsOpen}
              onToggle={(event) => setReasonsOpen(event.currentTarget.open)}
            >
              <summary className="inline-flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-md pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                查看具体原因
                <ChevronDownIcon aria-hidden="true" className="size-4 group-open/reasons:rotate-180" />
              </summary>
              {reasonsOpen ? (
                <div className="flex flex-col gap-2 text-sm">
                  {details.isPending || details.isPlaceholderData ? (
                    <p role="status" className="text-muted-foreground">
                      正在读取图片版本记录…
                    </p>
                  ) : details.isError ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p role="alert">无法读取图片版本记录。</p>
                      <Button type="button" variant="link" className="min-h-11" onClick={() => void details.refetch()}>
                        重试
                      </Button>
                    </div>
                  ) : pageDetails && pageDetails.revisionId !== data.revisionId ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p role="status">保存的图片已有更新，请重新读取记录。</p>
                      <Button
                        type="button"
                        variant="link"
                        className="min-h-11"
                        onClick={() => {
                          void query.refetch()
                          if (detailsOffset === 0) void details.refetch()
                          else setDetailsOffset(0)
                        }}
                      >
                        刷新版本记录
                      </Button>
                    </div>
                  ) : pageDetails ? (
                    <div className="flex flex-col gap-2" aria-live="polite">
                      {pageDetails.reason ? (
                        <p>
                          {archiveImageVersionReason(pageDetails.reason)}
                          {pageDetails.unresolvedPageCount > 0
                            ? `涉及 ${pageDetails.unresolvedPageCount} 张图片。`
                            : null}
                        </p>
                      ) : null}
                      {pageDetails.pages.length > 0 ? (
                        <ul role="list" className="flex flex-col gap-2">
                          {groupPageReasons(pageDetails.pages).map(({ reason, count, pages }) => (
                            <li key={reason} className="flex flex-col gap-0.5">
                              <span>{reason}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {count > 1 ? `${count} 张 · ` : ''}第 {pages} 页
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {pageDetails.total === 0 && !pageDetails.reason ? <p>没有更多图片版本记录。</p> : null}
                    </div>
                  ) : (
                    <p role="status">找不到当前的图片版本记录，请刷新页面。</p>
                  )}
                  {pageDetails?.revisionId === data.revisionId && pageDetails.total > REASON_BATCH_SIZE ? (
                    <nav aria-label="图片版本记录分页" className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        disabled={detailsOffset === 0 || details.isFetching}
                        onClick={() => setDetailsOffset(Math.max(0, detailsOffset - REASON_BATCH_SIZE))}
                      >
                        上一批
                      </Button>
                      <span aria-live="polite" className="text-xs text-muted-foreground tabular-nums">
                        第 {batchStart}
                        {batchEnd === batchStart ? '' : `–${batchEnd}`} 条，共 {pageDetails.total} 条
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        disabled={nextOffset === null || details.isFetching}
                        onClick={() => {
                          if (nextOffset !== null) setDetailsOffset(nextOffset)
                        }}
                      >
                        下一批
                      </Button>
                    </nav>
                  ) : null}
                  <Button asChild variant="link" className="min-h-11 self-start">
                    <Link href={archiveQualityAuditHref}>历史画质核验</Link>
                  </Button>
                </div>
              ) : null}
            </details>
          ) : null}

          {data.error ? (
            <p role="alert" className="text-sm text-destructive">
              {data.error}
            </p>
          ) : null}
          {data.blockedReason && data.quality.status !== 'ORIGINAL' ? (
            <p className="text-sm text-muted-foreground">当前作品缺少下载原图所需的来源记录。</p>
          ) : null}
          {(data.canUpgrade || data.active) && !changed ? (
            <p className="text-sm text-muted-foreground">
              任务成功后，原图会替换已保存的图片，阅读位置、书签和单图喜欢会保留。
            </p>
          ) : null}
          {changed || data.canUpgrade || data.active || taskHref || qualityHref ? (
            <div className="flex flex-wrap items-center gap-x-2">
              {changed ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    setBaseline({ artworkId, revisionId: data.revisionId })
                    router.refresh()
                  }}
                >
                  <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
                  刷新查看当前版本
                </Button>
              ) : data.canUpgrade || data.active ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={!data.canUpgrade || upgrade.isPending}
                  onClick={() => {
                    if (request.current?.revisionId !== data.revisionId) {
                      request.current = { revisionId: data.revisionId, key: crypto.randomUUID() }
                    }
                    upgrade.mutate({
                      artworkId,
                      expectedRevisionId: data.revisionId,
                      idempotencyKey: request.current.key
                    })
                  }}
                >
                  {upgrade.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <DownloadIcon data-icon="inline-start" aria-hidden="true" />
                  )}
                  {upgrade.isPending ? '正在提交…' : data.active ? '原图下载任务进行中' : '下载原图'}
                </Button>
              ) : null}
              {taskHref ? (
                <Button asChild variant="link" className="min-h-11">
                  <Link href={taskHref}>查看原图任务</Link>
                </Button>
              ) : null}
              {qualityHref ? (
                <Button asChild variant="link" className="min-h-11">
                  <Link href={qualityHref}>查看归档任务</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  )
}
