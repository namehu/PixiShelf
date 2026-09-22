'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { formatBackgroundJobStatus } from '@/app/admin/tasks/_components/background-task-format'
import { Empty, EmptyHeader, EmptyDescription } from '@/components/ui/empty'

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
  const error = preview.error ?? submit.error ?? result.error ?? source.error ?? target.error ?? candidates.error
  const busy = preview.isPending || submit.isPending

  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <AlertTitle>保留一个艺术家及其资料</AlertTitle>
        <AlertDescription>
          作品、来源身份和归档绑定归入保留方。姓名、简介、图片和星标全部采用保留方当前值，包括空值。旧艺术家不再可用，不提供一键撤销；作品与媒体文件不会被删除或移动。
        </AlertDescription>
      </Alert>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>
            <PrivacySensitiveText>{error.message}</PrivacySensitiveText>
          </AlertDescription>
        </Alert>
      )}
      {selection.mergeId ? (
        <Card>
          <CardHeader>
            <CardTitle>合并执行记录</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {result.isLoading ? (
              <Spinner />
            ) : (
              result.data && (
                <>
                  <p role="status">
                    {result.data.status === 'COMPLETE'
                      ? '合并完成，作品与归档绑定已迁移。'
                      : result.data.job
                        ? formatBackgroundJobStatus(result.data.job.status)
                        : '任务已提交，关闭页面不影响执行。'}
                  </p>
                  <PrivacySensitiveText as="p">
                    {result.data.summary.source.name}（#{result.data.summary.source.id}）→{' '}
                    {result.data.summary.target.name}（#{result.data.summary.target.id}） ·{' '}
                    {result.data.summary.mergedCount} 件作品
                  </PrivacySensitiveText>
                  {result.data.job?.message && (
                    <PrivacySensitiveText as="p">{result.data.job.message}</PrivacySensitiveText>
                  )}
                  {result.data.status === 'COMPLETE' && (
                    <Button asChild variant="outline">
                      <Link href={`/artists/${result.data.summary.target.id}`}>查看保留的艺术家</Link>
                    </Button>
                  )}
                  {result.data.job?.error && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        <PrivacySensitiveText>{result.data.job.error}</PrivacySensitiveText>
                      </AlertDescription>
                    </Alert>
                  )}
                  {result.data.job && (
                    <Button asChild variant="outline">
                      <Link href={jobHref(result.data.job.id)}>查看任务、取消或重试</Link>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      preview.reset()
                      submit.reset()
                      void setSelection({ sourceId: null, targetId: null, mergeId: null })
                    }}
                  >
                    开始新的合并
                  </Button>
                </>
              )
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>被合并方</CardTitle>
              </CardHeader>
              <CardContent>
                <PrivacySensitiveText>
                  {source.data
                    ? `${source.data.name} · #${source.data.id}`
                    : source.isFetching
                      ? '加载中…'
                      : selection.sourceId
                        ? '艺术家已不存在，请重新选择'
                        : '在下方选择被合并方'}
                </PrivacySensitiveText>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>保留方</CardTitle>
              </CardHeader>
              <CardContent>
                <PrivacySensitiveText>
                  {target.data
                    ? `${target.data.name} · #${target.data.id}`
                    : target.isFetching
                      ? '加载中…'
                      : selection.targetId
                        ? '艺术家已不存在，请重新选择'
                        : '在下方选择保留方'}
                </PrivacySensitiveText>
              </CardContent>
            </Card>
          </div>
          <Button
            variant="outline"
            disabled={!source.data || !target.data || busy}
            onClick={() => {
              preview.reset()
              void setSelection({ sourceId: selection.targetId, targetId: selection.sourceId })
            }}
          >
            <ArrowLeftRight data-icon="inline-start" />
            交换合并方向
          </Button>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              setSearchTerm(search)
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="artist-merge-search">搜索艺术家名称或来源 ID</FieldLabel>
                <div className="flex gap-2">
                  <Input id="artist-merge-search" value={search} onChange={(event) => setSearch(event.target.value)} />
                  <Button type="submit" variant="outline">
                    搜索
                  </Button>
                </div>
              </Field>
            </FieldGroup>
          </form>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {candidates.isFetching && <Spinner />}
            {candidates.data?.data?.map((artist) => (
              <div key={artist.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                <PrivacySensitiveText>
                  {artist.name} · #{artist.id} · {artist.artworksCount} 件作品
                </PrivacySensitiveText>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || artist.id === selection.targetId}
                    onClick={() => {
                      preview.reset()
                      void setSelection({ sourceId: artist.id })
                    }}
                  >
                    设为被合并方
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || artist.id === selection.sourceId}
                    onClick={() => {
                      preview.reset()
                      void setSelection({ targetId: artist.id })
                    }}
                  >
                    保留此艺术家
                  </Button>
                </div>
              </div>
            ))}
            {candidates.data?.data?.length === 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyDescription>未找到艺术家，请更换搜索词。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
          <Button
            disabled={!source.data || !target.data || source.data.id === target.data.id || busy}
            onClick={() => preview.mutate({ sourceArtistId: selection.sourceId!, targetArtistId: selection.targetId! })}
          >
            {preview.isPending && <Spinner />}预览合并影响
          </Button>
          {selectedPreview && (
            <Card>
              <CardHeader>
                <CardTitle>确认合并结果</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <PrivacySensitiveText as="p">
                  {selectedPreview.summary.source.name}（#{selectedPreview.summary.source.id}）→{' '}
                  {selectedPreview.summary.target.name}（#{selectedPreview.summary.target.id}）
                </PrivacySensitiveText>
                <p>
                  被合并方 {selectedPreview.summary.sourceCount} 件，保留方 {selectedPreview.summary.targetCount}{' '}
                  件，共同作品 {selectedPreview.summary.commonCount} 件；合并后 {selectedPreview.summary.mergedCount}{' '}
                  件。
                </p>
                <p>
                  迁移 {selectedPreview.summary.allMemberships} 条作品关系（含隐藏记录）、
                  {selectedPreview.summary.localMappings} 个本地目录映射、{selectedPreview.summary.tagMappings}{' '}
                  个来源标签映射。
                </p>
                <p>
                  归档绑定：{selectedPreview.summary.defaults} 个来源固定绑定、{selectedPreview.summary.pending}{' '}
                  个待生效绑定、{selectedPreview.summary.suppressions} 条人工移除记录。
                </p>
                <PrivacySensitiveText as="p">
                  来源身份：
                  {selectedPreview.summary.identities.map((ref) => `${ref.providerKey} ${ref.externalId}`).join('、') ||
                    '无'}
                </PrivacySensitiveText>
                <div className="grid gap-4 md:grid-cols-2">
                  {[selectedPreview.summary.source, selectedPreview.summary.target].map((artist) => (
                    <div key={artist.id} className="flex flex-col gap-2">
                      <PrivacySensitiveText as="p">
                        {artist.name} · 简介：{artist.bio || '空'}
                      </PrivacySensitiveText>
                      <p>
                        头像：{artist.avatar ? '已设置' : '空'}；背景图：{artist.backgroundImg ? '已设置' : '空'}
                        ；星标：{artist.isStarred ? '是' : '否'}
                      </p>
                    </div>
                  ))}
                </div>
                {selectedPreview.summary.conflicts.map((message) => (
                  <Alert key={message} variant="destructive">
                    <AlertDescription>{message}</AlertDescription>
                  </Alert>
                ))}
                {selectedPreview.blockers.map((blocker) => (
                  <Alert key={blocker.jobId}>
                    <AlertTitle>请先处理相关任务</AlertTitle>
                    <AlertDescription>
                      {blocker.reason}
                      <Link className="underline" href={jobHref(blocker.jobId)}>
                        {blocker.type} · {blocker.status} · 查看任务
                      </Link>
                    </AlertDescription>
                  </Alert>
                ))}
                <Button
                  variant="destructive"
                  disabled={busy || !!selectedPreview.summary.conflicts.length || !!selectedPreview.blockers.length}
                  onClick={() =>
                    submit.mutate({ previewId: selectedPreview.previewId, fingerprint: selectedPreview.fingerprint })
                  }
                >
                  {submit.isPending && <Spinner />}确认合并，保留 #{selectedPreview.summary.target.id}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
      <Card>
        <CardHeader>
          <CardTitle>最近提交的合并</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {history.data?.map((entry) => (
            <Link
              key={entry.id}
              className="underline underline-offset-4"
              href={`/admin/artists/merge?mergeId=${encodeURIComponent(entry.id)}`}
            >
              <PrivacySensitiveText>
                {entry.summary.source.name} → {entry.summary.target.name}
              </PrivacySensitiveText>
              {' · '}
              {new Date(entry.createdAt).toLocaleString()} · {entry.status === 'COMPLETE' ? '已完成' : '查看执行状态'}
            </Link>
          ))}
          {history.data?.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyDescription>暂无合并记录。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
