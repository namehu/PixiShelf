'use client'

import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/server'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { DeleteFileList } from '@/app/admin/artworks/_components/artwork-delete-preview'
import { DuplicateOrganization } from './duplicate-organization'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { formatArtworkDeleteReport } from '@pixishelf/job-contracts'

export type DeleteBatch = inferRouterOutputs<AppRouter>['artwork']['batchDeleteGet']
export function DuplicateBatchConfirmation({
  userId,
  batch,
  onClose,
  onSubmitted
}: {
  userId: string
  batch: DeleteBatch
  onClose: () => void
  onSubmitted: (batch: DeleteBatch) => void
}) {
  const trpc = useTRPC()
  const submit = useMutation(trpc.artwork.batchDeleteSubmit.mutationOptions())
  const stop = useMutation(trpc.artwork.batchDeleteStop.mutationOptions())
  const [expanded, setExpanded] = useState<number[]>([])
  const [paths, setPaths] = useState<Record<number, string[]>>(() =>
    Object.fromEntries(batch.payload.items.map((item) => [item.artworkId, item.selectedPaths]))
  )
  const direct = batch.payload.items.filter((item) => item.preview.mode === 'DIRECT_DELETE')
  const archive = batch.payload.items.filter((item) => item.preview.mode === 'ARCHIVE_TRASH')
  async function close() {
    if (submit.isPending) return
    try {
      await stop.mutateAsync({ jobId: batch.jobId, expectedUserId: userId })
      onClose()
    } catch {
      /* The mutation error stays visible in the confirmation. */
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void close()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>删除所选 {batch.payload.items.length} 部作品？</DialogTitle>
          <DialogDescription>按作品管理的删除规则处理，后台会继续执行，可以关闭页面。</DialogDescription>
        </DialogHeader>
        {direct.length ? (
          <section aria-label="永久删除作品" className="flex flex-col gap-2">
            <h3 className="font-medium">永久删除 · {direct.length} 部</h3>
            <p className="text-sm text-muted-foreground">
              整部作品、已选原件及整理记录将删除，无法撤销。独有、未配对和未核对的动图或视频也在整部删除范围内；保留作品不会补入这些内容。
            </p>
            {direct.map((item) => (
              <div key={item.artworkId} className="min-w-0">
                <p className="text-sm">
                  <PrivacySensitiveText>
                    #{item.artworkId} {item.preview.artwork.title}
                  </PrivacySensitiveText>
                </p>
                <DeletionLossSummary batch={batch} artworkId={item.artworkId} />
                <details
                  onToggle={(event) => {
                    const open = event.currentTarget.open
                    setExpanded((ids) =>
                      open ? [...new Set([...ids, item.artworkId])] : ids.filter((id) => id !== item.artworkId)
                    )
                  }}
                >
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm text-muted-foreground">
                    文件范围 · {paths[item.artworkId]?.length ?? 0} 个文件
                  </summary>
                  {expanded.includes(item.artworkId) ? (
                    <div className="flex h-64 flex-col">
                      <DeleteFileList
                        entries={item.preview.entries}
                        optional={item.preview.entries.filter((entry) => entry.selection === 'OPTIONAL')}
                        selected={new Set(paths[item.artworkId])}
                        directory={item.preview.artwork.directory}
                        pending={submit.isPending || Boolean(item.preview.recovery)}
                        searchKey=""
                        toggle={(targets, checked) =>
                          setPaths((current) => ({
                            ...current,
                            [item.artworkId]: checked
                              ? [...new Set([...(current[item.artworkId] ?? []), ...targets])]
                              : (current[item.artworkId] ?? []).filter((value) => !targets.includes(value))
                          }))
                        }
                      />
                    </div>
                  ) : null}
                  {item.preview.warnings.map((warning) => (
                    <p key={warning} className="mt-2 text-sm text-muted-foreground">
                      {warning}
                    </p>
                  ))}
                </details>
              </div>
            ))}
          </section>
        ) : null}
        {archive.length ? (
          <section aria-label="回收作品" className="flex flex-col gap-2">
            <h3 className="font-medium">移入回收站 · {archive.length} 部</h3>
            <p className="text-sm text-muted-foreground">
              归档整包回收，保留 7 天；保留期内可从归档回收站恢复。回收提交后，文件由后台任务移动。
            </p>
            {archive.map((item) => (
              <div key={item.artworkId}>
                <p className="text-sm">
                  <PrivacySensitiveText>
                    #{item.artworkId} {item.preview.artwork.title}
                  </PrivacySensitiveText>
                </p>
                <DeletionLossSummary batch={batch} artworkId={item.artworkId} />
              </div>
            ))}
          </section>
        ) : null}
        <p className="text-sm text-muted-foreground">整理记录不会合并到保留作品。标签、艺术家和系列实体本身保留。</p>
        {submit.error || stop.error ? (
          <p role="alert" className="text-sm text-destructive">
            {submit.error?.message ?? stop.error?.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={submit.isPending || stop.isPending} onClick={() => void close()}>
            返回选择
          </Button>
          <Button
            variant="destructive"
            disabled={submit.isPending || stop.isPending}
            onClick={() =>
              void submit
                .mutateAsync({
                  expectedUserId: userId,
                  jobId: batch.jobId,
                  items: batch.payload.items.map((item) => ({
                    artworkId: item.artworkId,
                    selectedPaths: paths[item.artworkId] ?? []
                  }))
                })
                .then(onSubmitted)
                .catch(() => undefined)
            }
          >
            {submit.isPending ? '正在提交…' : '确认删除'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeletionLossSummary({ batch, artworkId }: { batch: DeleteBatch; artworkId: number }) {
  const loss = batch.payload.origin?.losses?.find((entry) => entry.artworkId === artworkId)
  if (!loss) return null
  const own = loss.member.ownOrganization
  const organized =
    own.rating !== null ||
    own.bookmarks.available + own.bookmarks.unavailable + own.likes.available + own.likes.unavailable > 0 ||
    Boolean(loss.member.ownReading)
  const differences = loss.unmatched !== '0' || loss.unchecked !== '0'
  if (!differences && !organized && !loss.member.otherAccountHasOrganization) return null
  return (
    <div className="mt-1 flex flex-col gap-1">
      {differences ? (
        <p className="text-xs text-muted-foreground">
          选中对照关系中最多 {loss.unmatched} 项未配对 ·{' '}
          {loss.unchecked === null ? '未核对数量未知' : `未核对动图/视频 ${loss.unchecked} 项`}
          。未配对不等于内容独有（依本次检测记录）。
        </p>
      ) : null}
      {organized ? <DuplicateOrganization member={loss.member} /> : null}
      {loss.member.otherAccountHasOrganization ? (
        <p className="text-xs text-muted-foreground">还包含其他账户的整理记录，不会合并。</p>
      ) : null}
    </div>
  )
}

export function DuplicateBatchProgress({
  userId,
  runId,
  artistId,
  onConfirm
}: {
  userId: string
  runId?: string
  artistId?: number
  onConfirm: (batch: DeleteBatch) => void
}) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const options = trpc.artwork.batchDeleteList.queryOptions({
    expectedUserId: userId,
    ...(runId ? { runId } : { artistId })
  })
  const query = useQuery({
    ...options,
    refetchInterval: (query) =>
      query.state.data?.some(
        (batch) =>
          ['PENDING', 'RUNNING', 'RETRY_WAIT'].includes(batch.status) ||
          batch.archives.some((job) => ['PENDING', 'RUNNING', 'RETRY_WAIT'].includes(job.status))
      )
        ? 1500
        : false
  })
  const stop = useMutation(
    trpc.artwork.batchDeleteStop.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: options.queryKey })
    })
  )
  const retry = useMutation(
    trpc.artwork.batchDeleteRetry.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: options.queryKey })
    })
  )
  const [expanded, setExpanded] = useState<string[]>([])
  const [detailError, setDetailError] = useState('')
  const completedKey =
    query.data
      ?.flatMap((batch) =>
        batch.items
          .filter((item) => item.status === 'DELETED' || item.status === 'TRASH_SUBMITTED')
          .map((item) => `${batch.jobId}:${item.artworkId}`)
      )
      .join(',') ?? ''
  const previousKey = useRef('')
  useEffect(() => {
    if (!completedKey || previousKey.current === completedKey) return
    previousKey.current = completedKey
    void queryClient.invalidateQueries({ queryKey: trpc.artworkDedup.listGroups.queryKey() })
  }, [completedKey, queryClient, trpc])
  async function detail(jobId: string) {
    setDetailError('')
    return queryClient.fetchQuery(trpc.artwork.batchDeleteGet.queryOptions({ expectedUserId: userId, jobId }))
  }
  if (!query.data?.length) return null
  return (
    <div className="my-4 flex flex-col gap-3" aria-live="polite">
      {query.data
        .filter((batch) => batch.confirmed || batch.status === 'PAUSED')
        .map((batch, batchIndex) => {
          const finished = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(batch.status)
          const failed = batch.items.filter((item) => item.status === 'FAILED')
          const pendingArchives = batch.items.filter(
            (item) =>
              item.status === 'TRASH_SUBMITTED' &&
              item.archiveJobId &&
              !['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(item.archiveStatus ?? '')
          )
          const failedArchives = batch.items.filter(
            (item) => item.archiveJobId && ['FAILED', 'CANCELLED', 'SKIPPED'].includes(item.archiveStatus ?? '')
          )
          const card = (
            <Alert key={batch.jobId}>
              <AlertTitle>{batch.status === 'PAUSED' ? '删除尚未确认' : (batch.message ?? '删除任务')}</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <p>
                  共 {batch.total} 部 · 已处理{' '}
                  {batch.items.filter((item) => ['DELETED', 'TRASH_SUBMITTED', 'FAILED'].includes(item.status)).length}{' '}
                  部{batch.stopAfterCurrent && !finished ? ' · 当前作品结束后停止' : ''}
                </p>
                {pendingArchives.length ? <p>回收已提交，{pendingArchives.length} 部等待文件移动。</p> : null}
                {failedArchives.length ? (
                  <p role="alert" className="text-destructive">
                    {failedArchives.length} 部回收文件移动失败，请查看回收任务。
                  </p>
                ) : null}
                {[...pendingArchives, ...failedArchives].map((item) => (
                  <Button key={item.artworkId} variant="link" asChild className="w-fit">
                    <Link href={`/admin/tasks?jobId=${encodeURIComponent(item.archiveJobId!)}`}>
                      查看作品 #{item.artworkId} 的回收任务
                    </Link>
                  </Button>
                ))}
                {batch.items
                  .filter((item) => item.status === 'FAILED' || item.status === 'PROCESSING')
                  .map((item) => (
                    <p key={item.artworkId}>
                      #{item.artworkId} <PrivacySensitiveText>{item.title}</PrivacySensitiveText> · {item.message}
                    </p>
                  ))}
                <details
                  onToggle={(event) => {
                    const open = event.currentTarget.open
                    setExpanded((ids) =>
                      open ? [...new Set([...ids, batch.jobId])] : ids.filter((id) => id !== batch.jobId)
                    )
                  }}
                >
                  <summary className="cursor-pointer py-2">查看全部 {batch.total} 部作品的处理结果</summary>
                  {expanded.includes(batch.jobId)
                    ? batch.items.map((item) => {
                        const archive = batch.archives.find((job) => job.id === item.archiveJobId)
                        return (
                          <p key={item.artworkId}>
                            #{item.artworkId} <PrivacySensitiveText>{item.title}</PrivacySensitiveText> ·{' '}
                            {archive?.status === 'COMPLETED'
                              ? '文件已移入回收站'
                              : archive?.status === 'FAILED'
                                ? '回收文件移动失败，请查看回收任务'
                                : item.message}
                          </p>
                        )
                      })
                    : null}
                </details>
                <div className="flex flex-wrap gap-2">
                  {batch.status === 'PAUSED' && batch.stage === 'CONFIRMATION' ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void detail(batch.jobId)
                          .then(onConfirm)
                          .catch(() => setDetailError('未能读取确认范围，请重试。'))
                      }
                    >
                      继续确认
                    </Button>
                  ) : null}
                  {!finished ? (
                    <Button
                      variant="outline"
                      disabled={stop.isPending || batch.stopAfterCurrent}
                      onClick={() => stop.mutate({ expectedUserId: userId, jobId: batch.jobId })}
                    >
                      停止后续删除
                    </Button>
                  ) : null}
                  {finished &&
                  batch.confirmed &&
                  (failed.length > 0 ||
                    batch.items.some((item) => item.status === 'PENDING') ||
                    batch.items.some((item) => item.status === 'PROCESSING')) ? (
                    <Button
                      variant="outline"
                      disabled={retry.isPending}
                      onClick={() => retry.mutate({ expectedUserId: userId, jobId: batch.jobId })}
                    >
                      按原范围重试未完成作品
                    </Button>
                  ) : null}
                  {batch.items.some((item) => item.status !== 'PENDING' && item.status !== 'PROCESSING') ? (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        void detail(batch.jobId)
                          .then((full) => {
                            const url = URL.createObjectURL(
                              new Blob(
                                [
                                  full.result.items
                                    .flatMap((item) => (item.report ? [formatArtworkDeleteReport(item.report)] : []))
                                    .join('\n\n')
                                ],
                                { type: 'text/plain;charset=utf-8' }
                              )
                            )
                            const link = document.createElement('a')
                            link.href = url
                            link.download = `artwork-delete-${batch.jobId}.txt`
                            link.click()
                            URL.revokeObjectURL(url)
                          })
                          .catch(() => setDetailError('未能读取删除报告，请重试。'))
                      }
                    >
                      下载删除报告
                    </Button>
                  ) : null}
                </div>
              </AlertDescription>
            </Alert>
          )
          return batchIndex === 0 || !finished ? (
            card
          ) : (
            <details
              key={batch.jobId}
              onToggle={(event) => {
                const open = event.currentTarget.open
                setExpanded((ids) =>
                  open
                    ? [...new Set([...ids, `history:${batch.jobId}`])]
                    : ids.filter((id) => id !== `history:${batch.jobId}`)
                )
              }}
            >
              <summary className="cursor-pointer py-2 text-sm text-muted-foreground">
                历史批次 · {batch.total} 部 · {batch.message}
              </summary>
              {expanded.includes(`history:${batch.jobId}`) ? card : null}
            </details>
          )
        })}
      {detailError ? (
        <p role="alert" className="text-sm text-destructive">
          {detailError}
        </p>
      ) : null}
      {stop.error || retry.error ? (
        <p role="alert" className="text-sm text-destructive">
          {stop.error?.message ?? retry.error?.message}
        </p>
      ) : null}
    </div>
  )
}
