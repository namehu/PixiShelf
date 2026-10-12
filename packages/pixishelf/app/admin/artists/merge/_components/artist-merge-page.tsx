'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  CircleCheck,
  History,
  Info,
  Search,
  TriangleAlert,
  UserRound
} from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { formatBackgroundJobStatus } from '@/app/admin/tasks/_components/background-task-format'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty'

interface ArtistIdentity {
  id: number
  name: string
  avatar?: string | null
  artworksCount?: number
}

function ArtistIdentityView({ artist, count }: { artist: ArtistIdentity; count?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar key={artist.avatar} className="size-10">
        <AvatarImage src={artist.avatar ?? undefined} alt="" className="object-cover" />
        <AvatarFallback>
          <PrivacySensitiveText>{artist.name.slice(0, 2)}</PrivacySensitiveText>
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-1">
        <PrivacySensitiveText className="break-words font-medium">{artist.name}</PrivacySensitiveText>
        <span className="text-xs text-muted-foreground tabular-nums">
          #{artist.id} · {count ?? artist.artworksCount ?? 0} 件作品
        </span>
      </div>
    </div>
  )
}

const jobHref = (id: string) => `/admin/tasks?jobId=${encodeURIComponent(id)}`

export function ArtistMergePage() {
  const trpc = useTRPC()
  const cache = useQueryClient()
  const [selection, setSelection] = useQueryStates({
    sourceId: parseAsInteger,
    targetId: parseAsInteger,
    mergeId: parseAsString
  })
  const [search, setSearch] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const source = useQuery(
    trpc.artist.getById.queryOptions(selection.sourceId ?? 0, { enabled: !!selection.sourceId && !selection.mergeId })
  )
  const target = useQuery(
    trpc.artist.getById.queryOptions(selection.targetId ?? 0, { enabled: !!selection.targetId && !selection.mergeId })
  )
  const candidates = useQuery(
    trpc.artist.queryPage.queryOptions(
      { search: searchTerm, pageSize: 20, ...(source.data ? { kind: source.data.kind } : {}) },
      { enabled: !selection.mergeId }
    )
  )
  const preview = useMutation(trpc.artist.previewMerge.mutationOptions())
  const submit = useMutation(
    trpc.artist.submitMerge.mutationOptions({
      onSuccess: async (result) => {
        await setSelection({ mergeId: result.mergeId })
        await cache.invalidateQueries()
      }
    })
  )
  const result = useQuery(
    trpc.artist.getMerge.queryOptions(
      { mergeId: selection.mergeId ?? '' },
      {
        enabled: !!selection.mergeId,
        refetchInterval: (query) =>
          query.state.data?.status === 'COMPLETE' ||
          ['FAILED', 'CANCELLED'].includes(query.state.data?.job?.status ?? '')
            ? false
            : 2000
      }
    )
  )
  const history = useQuery(trpc.artist.listMerges.queryOptions())
  const invalidated = useRef<string | null>(null)
  useEffect(() => {
    if (result.data?.status === 'COMPLETE' && invalidated.current !== result.data.id) {
      invalidated.current = result.data.id
      void cache.invalidateQueries()
    }
  }, [result.data, cache])
  const selectedPreview =
    preview.data &&
    preview.data.summary.source.id === selection.sourceId &&
    preview.data.summary.target.id === selection.targetId
      ? preview.data
      : null
  const error = selection.mergeId
    ? result.error
    : (preview.error ?? submit.error ?? source.error ?? target.error ?? candidates.error)
  const busy = preview.isPending || submit.isPending

  const completed = result.data?.status === 'COMPLETE'
  const failed = ['FAILED', 'CANCELLED'].includes(result.data?.job?.status ?? '')
  const emptyTargetFields = selectedPreview
    ? [
        selectedPreview.summary.source.bio && !selectedPreview.summary.target.bio ? '简介' : null,
        selectedPreview.summary.source.avatar && !selectedPreview.summary.target.avatar ? '头像' : null,
        selectedPreview.summary.source.backgroundImg && !selectedPreview.summary.target.backgroundImg ? '背景图' : null
      ].filter(Boolean)
    : []
  const startNewMerge = () => {
    preview.reset()
    submit.reset()
    void setSelection({ sourceId: null, targetId: null, mergeId: null })
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>
            <PrivacySensitiveText>{error.message}</PrivacySensitiveText>
          </AlertDescription>
        </Alert>
      )}
      {selection.mergeId ? (
        <section aria-label="合并执行结果" className="rounded-xl border bg-card p-5 sm:p-6">
          {result.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Spinner />
              正在读取合并记录…
            </div>
          ) : result.data ? (
            <div className="flex flex-col gap-5">
              <div className="flex items-start gap-3">
                {completed ? (
                  <CircleCheck className="mt-0.5 size-6 shrink-0 text-success" aria-hidden="true" />
                ) : failed ? (
                  <TriangleAlert className="mt-0.5 size-6 shrink-0 text-destructive" aria-hidden="true" />
                ) : (
                  <Info className="mt-0.5 size-6 shrink-0 text-primary" aria-hidden="true" />
                )}
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-semibold" role="status">
                    {completed
                      ? '合并完成'
                      : result.data.job
                        ? formatBackgroundJobStatus(result.data.job.status)
                        : '任务已提交'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {completed
                      ? '作品、来源身份与归档绑定已归入保留方。'
                      : failed
                        ? '合并尚未完成，请查看任务详情。'
                        : '任务在后台执行，关闭页面不影响进度。'}
                  </p>
                </div>
              </div>
              <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
                <ArtistIdentityView artist={result.data.summary.source} count={result.data.summary.sourceCount} />
                <ArrowRight className="size-5 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden="true" />
                <div className="flex flex-col gap-2">
                  <Badge variant="success">保留艺术家</Badge>
                  <ArtistIdentityView
                    artist={result.data.summary.target}
                    count={completed ? result.data.summary.mergedCount : result.data.summary.targetCount}
                  />
                </div>
              </div>
              <Separator />
              <p className="text-sm">
                {completed ? '合并后' : '预计合并后'}{' '}
                <strong className="tabular-nums">{result.data.summary.mergedCount}</strong> 件作品
                <span className="ml-3 text-muted-foreground">
                  共同作品 {result.data.summary.commonCount} 件，只计一次
                </span>
              </p>
              {!completed && result.data.job?.message && (
                <PrivacySensitiveText as="p" className="text-sm text-muted-foreground">
                  {result.data.job.message}
                </PrivacySensitiveText>
              )}
              {result.data.job?.error && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <PrivacySensitiveText>{result.data.job.error}</PrivacySensitiveText>
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {completed && (
                  <Button asChild>
                    <Link href={`/artists/${result.data.summary.target.id}`}>
                      查看保留的艺术家
                      <ArrowRight data-icon="inline-end" />
                    </Link>
                  </Button>
                )}
                {result.data.job && (
                  <Button asChild variant={completed ? 'ghost' : 'default'}>
                    <Link href={jobHref(result.data.job.id)}>
                      {completed ? '查看任务详情' : '查看任务、取消或重试'}
                    </Link>
                  </Button>
                )}
                <Button variant="outline" onClick={startNewMerge}>
                  开始新的合并
                </Button>
              </div>
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyDescription>无法读取合并记录，请重新打开记录或开始新的合并。</EmptyDescription>
              </EmptyHeader>
              <Button variant="outline" onClick={startNewMerge}>
                开始新的合并
              </Button>
            </Empty>
          )}
        </section>
      ) : (
        <>
          <section aria-label="合并方向" className="rounded-xl border bg-card p-4 sm:p-5">
            <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
              <div className="flex min-w-0 flex-col gap-3">
                <span className="text-xs font-medium text-muted-foreground">被合并方 · 归入保留方</span>
                {source.data ? (
                  <ArtistIdentityView artist={source.data} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {source.isFetching
                      ? '加载中…'
                      : selection.sourceId
                        ? '艺术家已不存在，请重新选择'
                        : '从下方选择被合并的艺术家'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 sm:flex-col">
                <ArrowRight className="size-5 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden="true" />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="交换合并方向"
                  disabled={!source.data || !target.data || busy}
                  onClick={() => {
                    preview.reset()
                    void setSelection({ sourceId: selection.targetId, targetId: selection.sourceId })
                  }}
                >
                  <ArrowLeftRight data-icon="inline-start" />
                  交换
                </Button>
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <Badge variant="info">保留方 · 沿用此艺术家的资料</Badge>
                {target.data ? (
                  <ArtistIdentityView artist={target.data} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {target.isFetching
                      ? '加载中…'
                      : selection.targetId
                        ? '艺术家已不存在，请重新选择'
                        : '从下方选择要保留的艺术家'}
                  </p>
                )}
              </div>
            </div>
          </section>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <section aria-labelledby="artist-selection-title" className="flex min-w-0 flex-col gap-4">
              <div className="flex items-baseline justify-between gap-2">
                <h2 id="artist-selection-title" className="font-semibold">
                  选择艺术家
                </h2>
                <span className="text-xs text-muted-foreground">同一创作者，保留一份资料</span>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  setSearchTerm(search.trim())
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="artist-merge-search" className="sr-only">
                      搜索艺术家名称或来源 ID
                    </FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        id="artist-merge-search"
                        placeholder="搜索名称或来源 ID"
                        value={search}
                        disabled={busy}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                      <Button type="submit" variant="outline" disabled={busy}>
                        <Search data-icon="inline-start" />
                        搜索
                      </Button>
                    </div>
                  </Field>
                </FieldGroup>
              </form>
              <div className="max-h-80 overflow-y-auto rounded-lg border" aria-busy={candidates.isFetching}>
                {candidates.isFetching && (
                  <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground" role="status">
                    <Spinner />
                    正在查找艺术家…
                  </div>
                )}
                <ul className="divide-y">
                  {candidates.data?.data?.map((artist) => (
                    <li
                      key={artist.id}
                      className={cn(
                        'flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between',
                        (artist.id === selection.sourceId || artist.id === selection.targetId) && 'bg-muted/40'
                      )}
                    >
                      <ArtistIdentityView artist={artist} />
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || artist.id === selection.targetId || artist.id === selection.sourceId}
                          onClick={() => {
                            preview.reset()
                            void setSelection({ sourceId: artist.id })
                          }}
                        >
                          {artist.id === selection.sourceId && <Check data-icon="inline-start" />}
                          {artist.id === selection.sourceId ? '已选为被合并方' : '设为被合并方'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || artist.id === selection.sourceId || artist.id === selection.targetId}
                          onClick={() => {
                            preview.reset()
                            void setSelection({ targetId: artist.id })
                          }}
                        >
                          {artist.id === selection.targetId && <Check data-icon="inline-start" />}
                          {artist.id === selection.targetId ? '已选为保留方' : '保留此艺术家'}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                {!candidates.isFetching && candidates.data?.data?.length === 0 && (
                  <Empty>
                    <EmptyHeader>
                      <EmptyDescription>未找到艺术家，请更换搜索词。</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">选好双方后，先核对合并影响。</p>
                <Button
                  variant={selectedPreview ? 'outline' : 'default'}
                  disabled={!source.data || !target.data || source.data.id === target.data.id || busy}
                  onClick={() =>
                    preview.mutate({ sourceArtistId: selection.sourceId!, targetArtistId: selection.targetId! })
                  }
                >
                  {preview.isPending && <Spinner />}
                  {selectedPreview ? '重新预览' : '预览合并影响'}
                </Button>
              </div>
            </section>
            <section
              aria-labelledby="merge-preview-title"
              className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5"
            >
              <h2 id="merge-preview-title" className="font-semibold">
                {selectedPreview ? '确认合并结果' : '合并影响预览'}
              </h2>
              {selectedPreview ? (
                <>
                  <div className="flex flex-col gap-3">
                    <h3 className="text-lg font-semibold tabular-nums">
                      合并后 {selectedPreview.summary.mergedCount} 件作品
                    </h3>
                    <dl className="grid grid-cols-3 gap-3 text-sm">
                      {[
                        ['被合并方', selectedPreview.summary.sourceCount],
                        ['保留方', selectedPreview.summary.targetCount],
                        ['共同作品', selectedPreview.summary.commonCount]
                      ].map(([label, value]) => (
                        <div key={label} className="flex flex-col gap-1">
                          <dt className="text-xs text-muted-foreground">{label}</dt>
                          <dd className="tabular-nums">{value} 件</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      作品取并集，共同作品只计一次；媒体文件不会删除或移动。
                    </p>
                  </div>
                  <Separator />
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-medium">资料取舍</h3>
                    <p className="text-xs text-muted-foreground">
                      全部沿用保留方当前值，包括空值；被合并方的资料不会补入。
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>资料</TableHead>
                          <TableHead>被合并方</TableHead>
                          <TableHead>保留方 · 合并后</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell>姓名</TableCell>
                          <TableCell className="whitespace-normal break-words">
                            <PrivacySensitiveText>{selectedPreview.summary.source.name}</PrivacySensitiveText>
                          </TableCell>
                          <TableCell className="whitespace-normal break-words">
                            <PrivacySensitiveText>{selectedPreview.summary.target.name}</PrivacySensitiveText>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>简介</TableCell>
                          {[selectedPreview.summary.source, selectedPreview.summary.target].map((artist) => (
                            <TableCell key={artist.id} className="max-w-48 whitespace-normal break-words">
                              <PrivacySensitiveText>{artist.bio || '空'}</PrivacySensitiveText>
                            </TableCell>
                          ))}
                        </TableRow>
                        {(['avatar', 'backgroundImg', 'isStarred'] as const).map((field) => (
                          <TableRow key={field}>
                            <TableCell>
                              {{ avatar: '头像', backgroundImg: '背景图', isStarred: '星标' }[field]}
                            </TableCell>
                            {[selectedPreview.summary.source, selectedPreview.summary.target].map((artist) => (
                              <TableCell key={artist.id}>
                                {field === 'isStarred'
                                  ? artist[field]
                                    ? '是'
                                    : '否'
                                  : artist[field]
                                    ? '已设置'
                                    : '空'}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {emptyTargetFields.length > 0 && (
                      <Alert>
                        <Info />
                        <AlertTitle>保留方的{emptyTargetFields.join('、')}为空</AlertTitle>
                        <AlertDescription>
                          合并后仍为空，被合并方的对应资料不会保留。如需沿用，请先修改保留方资料，再重新预览。
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                  <details className="group text-sm">
                    <summary className="cursor-pointer rounded-md py-1 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      来源与归档迁移明细
                    </summary>
                    <div className="flex flex-col gap-3 pt-3 text-xs leading-relaxed text-muted-foreground">
                      <p>
                        迁移 {selectedPreview.summary.allMemberships} 条作品关系（含隐藏记录）、
                        {selectedPreview.summary.localMappings} 个本地目录映射、{selectedPreview.summary.tagMappings}{' '}
                        个来源标签映射。
                      </p>
                      <p>
                        归档绑定：{selectedPreview.summary.defaults} 个来源固定绑定、{selectedPreview.summary.pending}{' '}
                        个待生效绑定、{selectedPreview.summary.suppressions} 条人工移除记录。
                      </p>
                      <PrivacySensitiveText as="p" className="break-words">
                        来源身份：
                        {selectedPreview.summary.identities
                          .map((ref) => `${ref.providerKey} ${ref.externalId}`)
                          .join('、') || '无'}
                      </PrivacySensitiveText>
                    </div>
                  </details>
                  {selectedPreview.summary.conflicts.map((message) => (
                    <Alert key={message} variant="destructive">
                      <TriangleAlert />
                      <AlertTitle>来源身份冲突</AlertTitle>
                      <AlertDescription>{message}</AlertDescription>
                    </Alert>
                  ))}
                  {selectedPreview.blockers.map((blocker) => (
                    <Alert key={blocker.jobId}>
                      <Info />
                      <AlertTitle>请先处理相关任务</AlertTitle>
                      <AlertDescription>
                        {blocker.reason}
                        <Link className="underline underline-offset-4" href={jobHref(blocker.jobId)}>
                          {blocker.type} · {blocker.status} · 查看任务
                        </Link>
                      </AlertDescription>
                    </Alert>
                  ))}
                  <Separator />
                  <div className="flex flex-col gap-3 sm:items-end">
                    <p className="self-start text-xs leading-relaxed text-muted-foreground">
                      确认后旧艺术家不再可用，不提供一键撤销。
                    </p>
                    <Button
                      variant="destructive"
                      disabled={busy || !!selectedPreview.summary.conflicts.length || !!selectedPreview.blockers.length}
                      onClick={() =>
                        submit.mutate({
                          previewId: selectedPreview.previewId,
                          fingerprint: selectedPreview.fingerprint
                        })
                      }
                    >
                      {submit.isPending && <Spinner />}确认合并，保留 #{selectedPreview.summary.target.id}
                    </Button>
                  </div>
                </>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <UserRound />
                    </EmptyMedia>
                    <EmptyTitle>{source.data && target.data ? '双方已选好，下一步核对影响' : '先选择两位艺术家'}</EmptyTitle>
                    <EmptyDescription>点击「预览合并影响」，查看作品数量、资料取舍和归档迁移情况，核对后再确认。</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </section>
          </div>
        </>
      )}
      <details className="group border-t pt-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <History className="size-4" aria-hidden="true" />
          最近提交的合并
          <span className="tabular-nums">({history.data?.length ?? 0})</span>
          <ArrowRight
            className="ml-auto size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-3 flex max-h-64 flex-col overflow-y-auto">
          {history.isLoading && <p className="py-3 text-sm text-muted-foreground">正在读取合并记录…</p>}
          {history.error && (
            <Alert variant="destructive">
              <AlertDescription>
                <PrivacySensitiveText>{history.error.message}</PrivacySensitiveText>
              </AlertDescription>
            </Alert>
          )}
          {history.data?.map((entry) => (
            <Link
              key={entry.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              href={`/admin/artists/merge?mergeId=${encodeURIComponent(entry.id)}`}
            >
              <PrivacySensitiveText className="min-w-0 break-words">
                {entry.summary.source.name} (#{entry.summary.source.id}) → {entry.summary.target.name} (#
                {entry.summary.target.id})
              </PrivacySensitiveText>
              <time
                className="text-xs text-muted-foreground tabular-nums"
                dateTime={new Date(entry.createdAt).toISOString()}
              >
                {new Date(entry.createdAt).toLocaleString()}
              </time>
              <Badge variant={entry.status === 'COMPLETE' ? 'success' : 'muted'} className="sm:ml-auto">
                {entry.status === 'COMPLETE' ? '已完成' : '查看执行状态'}
              </Badge>
            </Link>
          ))}
          {history.data?.length === 0 && <p className="py-3 text-sm text-muted-foreground">暂无合并记录。</p>}
        </div>
      </details>
    </div>
  )
}
