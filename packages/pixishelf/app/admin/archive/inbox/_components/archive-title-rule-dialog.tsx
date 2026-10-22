'use client'

import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  archiveTitleRulesSchema,
  archiveTitleEvaluationSchema,
  decodeArchiveTitle,
  evaluateArchiveTitleRules,
  type ArchiveTitleRules
} from '@pixishelf/job-contracts'
import { toast } from 'sonner'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTRPC } from '@/lib/trpc'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { ArchiveTitleRuleFields } from './archive-title-rule-fields'
import { ArchiveTitleMatchEvidence } from './archive-title-match-evidence'

type PreviewView = 'ALL' | 'ACCEPTED' | 'FILTERED' | 'NEWLY_ACCEPTED' | 'NEWLY_FILTERED'

export function ArchiveTitleRuleDialog({
  sourceId,
  rulesVersion,
  initialRules,
  activeScan,
  onClose
}: {
  sourceId: string
  rulesVersion: number
  initialRules: ArchiveTitleRules
  activeScan: boolean
  onClose: () => void
}) {
  const trpc = useTRPC()
  const client = useQueryClient()
  const [rules, setRules] = useState(initialRules)
  const [revisionId, setRevisionId] = useState<string | null>(null)
  const [view, setView] = useState<PreviewView>('ALL')
  const [testTitle, setTestTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const hydrated = useRef(false)
  const attempt = useRef<{ key: string; id: string } | null>(null)
  const latest = useQuery(
    trpc.archiveSearch.latestRulePreview.queryOptions({ sourceId }, { staleTime: 0, refetchOnMount: 'always' })
  )
  useEffect(() => {
    // A cached APPLIED/null result must not consume restoration before the current request finishes.
    if (hydrated.current || !latest.isSuccess || !latest.isFetchedAfterMount) return
    hydrated.current = true
    if (latest.data && ['PENDING', 'READY', 'STALE'].includes(latest.data.status)) {
      setRules(latest.data.rules)
      setRevisionId(latest.data.id)
    }
  }, [latest.data, latest.isSuccess, latest.isFetchedAfterMount])
  const preview = useQuery(
    trpc.archiveSearch.rulePreview.queryOptions(
      { sourceId, revisionId: revisionId ?? 'none' },
      {
        enabled: Boolean(revisionId),
        refetchInterval: (query) =>
          query.state.data?.status === 'PENDING' && !['FAILED', 'CANCELLED'].includes(query.state.data.jobStatus ?? '')
            ? 1000
            : false
      }
    )
  )
  const page = useInfiniteQuery(
    trpc.archiveSearch.rulePreviewItems.infiniteQueryOptions(
      { sourceId, revisionId: revisionId ?? 'none', limit: 50, view },
      {
        enabled: Boolean(revisionId) && preview.data?.status === 'READY',
        initialCursor: null,
        getNextPageParam: (last) => last.nextCursor
      }
    )
  )
  const onError = (cause: unknown) => setError(archiveClientErrorMessage(cause, '操作失败，请重试。'))
  const create = useMutation(
    trpc.archiveSearch.previewRules.mutationOptions({
      onError,
      onSuccess: (value) => {
        attempt.current = null
        setRevisionId(value.revisionId)
        void client.invalidateQueries({
          queryKey: trpc.archiveSearch.latestRulePreview.queryOptions({ sourceId }).queryKey
        })
      }
    })
  )
  const apply = useMutation(
    trpc.archiveSearch.applyRules.mutationOptions({
      onError: (cause) => {
        onError(cause)
        void preview.refetch()
      },
      onSuccess: async () => {
        toast.success('规则已应用，全部候选已更新')
        await client.invalidateQueries({ queryKey: trpc.archiveSearch.pathKey() })
        onClose()
      }
    })
  )
  const cancel = useMutation(
    trpc.archiveSearch.cancelRulePreview.mutationOptions({
      onError,
      onSuccess: () => {
        void preview.refetch()
      }
    })
  )
  const running = preview.data?.status === 'PENDING' && !['FAILED', 'CANCELLED'].includes(preview.data.jobStatus ?? '')
  const busy = create.isPending || apply.isPending
  const parsedRules = archiveTitleRulesSchema.safeParse(rules)
  const trial =
    testTitle.trim() && parsedRules.success
      ? evaluateArchiveTitleRules(parsedRules.data, { origin: 'REMOTE', titles: [testTitle] })
      : null
  const buildPreview = () => {
    setError(null)
    if (!parsedRules.success) {
      setError(parsedRules.error.issues[0]?.message ?? '请检查规则')
      return
    }
    hydrated.current = true
    const key = JSON.stringify([rulesVersion, parsedRules.data])
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() }
    create.mutate({ sourceId, rulesVersion, rules: parsedRules.data, requestId: attempt.current.id })
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent
        fitViewport
        className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 text-left">
          <DialogTitle>编辑本地接纳规则</DialogTitle>
          <DialogDescription>
            先预览全部已保存候选，再应用规则。保留扫描进度和人工决定，不会自动下载。
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain p-5">
          <ArchiveTitleRuleFields
            value={rules}
            disabled={busy || running}
            onChange={(next) => {
              hydrated.current = true
              setRules(next)
              setRevisionId(null)
              setError(null)
            }}
          />
          <Field>
            <FieldLabel htmlFor="title-rule-trial">试算一个标题</FieldLabel>
            <Input
              id="title-rule-trial"
              value={testTitle}
              onChange={(event) => setTestTitle(event.target.value)}
              placeholder="粘贴标题，只试算，不保存候选"
            />
            {trial ? <ArchiveTitleMatchEvidence evaluation={trial} /> : null}
          </Field>
          {running ? (
            <Alert>
              <AlertTitle className="flex items-center gap-2">
                <Spinner />
                正在预览全部候选
              </AlertTitle>
              <AlertDescription>
                已检查 {preview.data?.checkedCount ?? 0} 条。关闭弹窗后任务仍继续，可再次打开查看。
                <Button
                  variant="outline"
                  size="sm"
                  disabled={cancel.isPending}
                  onClick={() => revisionId && cancel.mutate({ sourceId, revisionId })}
                >
                  取消预览
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {preview.data?.status === 'STALE' ? (
            <Alert>
              <AlertTitle>预览已过期</AlertTitle>
              <AlertDescription>候选、人工决定或规则已变化，请重新预览。</AlertDescription>
            </Alert>
          ) : null}
          {preview.data?.jobStatus === 'FAILED' || preview.data?.status === 'CANCELLED' ? (
            <Alert>
              <AlertTitle>预览未完成</AlertTitle>
              <AlertDescription>当前规则未改变，可以重新预览。</AlertDescription>
            </Alert>
          ) : null}
          {preview.data?.status === 'READY' ? (
            <section className="flex min-w-0 flex-col gap-3" aria-label="规则预览结果">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" aria-live="polite">
                <span className="font-medium tabular-nums">共 {preview.data.checkedCount} 条</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-success">
                  <Check aria-hidden="true" className="size-4" />
                  接纳 <span className="tabular-nums">{preview.data.acceptedCount}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
                  <X aria-hidden="true" className="size-4" />
                  过滤 <span className="tabular-nums">{preview.data.filteredCount}</span>
                </span>
                <span className="text-xs text-muted-foreground">保留人工决定 {preview.data.manualCount} 条</span>
              </div>
              <ToggleGroup
                type="single"
                variant="outline"
                className="flex w-full flex-wrap justify-start"
                value={view}
                onValueChange={(value) => value && setView(value as PreviewView)}
                aria-label="预览结果范围"
              >
                <ToggleGroupItem value="ALL">全部</ToggleGroupItem>
                <ToggleGroupItem value="ACCEPTED">接纳</ToggleGroupItem>
                <ToggleGroupItem value="FILTERED">过滤</ToggleGroupItem>
                <ToggleGroupItem value="NEWLY_ACCEPTED">新增接纳 {preview.data.newlyAcceptedCount}</ToggleGroupItem>
                <ToggleGroupItem value="NEWLY_FILTERED">新增排除 {preview.data.newlyFilteredCount}</ToggleGroupItem>
              </ToggleGroup>
              {page.isPending ? <Spinner aria-label="加载预览明细" /> : null}
              {page.data?.pages
                .flatMap((group) => group.items)
                .map((item) => {
                  const StatusIcon = item.accepted ? Check : X
                  return (
                    <article
                      key={item.catalogItemId}
                      className="flex min-w-0 items-start gap-3 rounded-lg border p-3 sm:p-4"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-full',
                          item.accepted ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                        )}
                      >
                        <StatusIcon className="size-4" strokeWidth={2.5} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span className={cn('font-medium', item.accepted ? 'text-success' : 'text-destructive')}>
                            {item.accepted ? '接纳' : '过滤'}
                          </span>
                          <span className="text-muted-foreground">#{item.catalogItem.externalId}</span>
                        </p>
                        <PrivacySensitiveText
                          as="p"
                          className="break-words text-sm font-medium leading-relaxed [overflow-wrap:anywhere]"
                        >
                          {decodeArchiveTitle(item.catalogItem.title)}
                        </PrivacySensitiveText>
                        <ArchiveTitleMatchEvidence
                          evaluation={archiveTitleEvaluationSchema.safeParse(item.evaluation).data}
                          decision={item.reviewDecision}
                          showStatusMarker={false}
                        />
                      </div>
                    </article>
                  )
                })}
              {page.isSuccess && !page.data.pages.some((group) => group.items.length) ? (
                <p className="py-4 text-sm text-muted-foreground">这个范围没有候选。</p>
              ) : null}
              {page.hasNextPage ? (
                <Button variant="outline" disabled={page.isFetchingNextPage} onClick={() => void page.fetchNextPage()}>
                  加载更多预览
                </Button>
              ) : null}
              {page.isError ? (
                <Button variant="outline" onClick={() => void page.refetch()}>
                  预览明细加载失败，重试
                </Button>
              ) : null}
            </section>
          ) : null}
          {error || preview.isError || latest.isError ? (
            <Alert variant="destructive">
              <AlertTitle>请检查后重试</AlertTitle>
              <AlertDescription>{error ?? '预览加载失败，请关闭弹窗后重试。'}</AlertDescription>
            </Alert>
          ) : null}
          {activeScan ? (
            <p className="text-sm text-muted-foreground">当前有活动扫描，完成或取消后才能应用规则。</p>
          ) : null}
        </div>
        <DialogFooter className="grid shrink-0 grid-cols-2 gap-2 border-t p-4 sm:flex">
          <Button variant="outline" className="h-11" disabled={busy} onClick={onClose}>
            关闭
          </Button>
          {preview.data?.status === 'READY' ? (
            <Button
              className="h-11"
              disabled={busy || activeScan}
              onClick={() => revisionId && apply.mutate({ sourceId, revisionId })}
            >
              {apply.isPending ? <Spinner data-icon="inline-start" /> : null}应用规则
            </Button>
          ) : (
            <Button className="h-11" disabled={busy || running} onClick={buildPreview}>
              {create.isPending ? <Spinner data-icon="inline-start" /> : null}预览全部候选
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
