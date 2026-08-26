'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  ExternalLinkIcon,
  InboxIcon,
  ListFilterIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon
} from 'lucide-react'
import { toast } from 'sonner'
import type { AppRouter } from '@/server'
import { useTRPC } from '@/lib/trpc'
import { AdminTableFrame } from '@/app/admin/_components/admin-workbench'
import { ArchiveAddDialog } from '@/app/admin/archive/_components/archive-add-dialog'
import {
  ArchiveBulkResultDialog,
  type ArchiveBulkOperationView
} from '@/app/admin/archive/_components/archive-bulk-result-dialog'
import { archiveClientErrorMessage } from '@/app/admin/archive/_components/archive-client-error'
import { ArchiveReplaceDialog } from '@/app/admin/archive/_components/archive-replace-dialog'
import { ArchiveSubmissionBadge } from '@/app/admin/archive/_components/archive-submission-badge'
import {
  archiveIntakePollingInterval,
  archiveIntakeItemHref,
  archiveTaskHref,
  clearArchiveIntakeItemHref,
  countArchiveIntakeActions,
  getOrCreateArchiveCommandKey,
  isSelectableIntakeItem,
  isRetryableIntakeItem,
  reconcileArchiveIntakeSelection,
  releaseArchiveCommandKey,
  updateArchiveIntakeSelection,
  type ArchiveIntakeSelectionState,
  type ArchiveQuality
} from '@/app/admin/archive/_components/archive-intake-view-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type RouterOutputs = inferRouterOutputs<AppRouter>
type IntakeItem = RouterOutputs['archiveInbox']['list']['items'][number]
type IntakeView = 'ACTIVE' | 'FAILED' | 'ENQUEUED' | 'CANCELLED'

const createEmptySelection = (): ArchiveIntakeSelectionState => ({
  selectedIds: new Set(),
  manuallyDeselectedIds: new Set(),
  qualityById: new Map()
})

const ACTIVE_STATUSES = new Set(['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE'])

export function ArchiveInbox() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const locatedItemId = searchParams.get('itemId')?.trim() || null
  const commandKeys = useRef(new Map<string, string>())
  const [view, setView] = useState<IntakeView>('ACTIVE')
  const [cursor, setCursor] = useState<string>()
  const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([])
  const [searchDraft, setSearchDraft] = useState('')
  const [submissionDraft, setSubmissionDraft] = useState('')
  const [search, setSearch] = useState('')
  const [submissionId, setSubmissionId] = useState('')
  const [providerKey, setProviderKey] = useState('ALL')
  const [selection, setSelection] = useState<ArchiveIntakeSelectionState>(createEmptySelection)
  const [operation, setOperation] = useState<ArchiveBulkOperationView | null>(null)
  const [cancelConfirmationOpen, setCancelConfirmationOpen] = useState(false)
  const [replacementItemId, setReplacementItemId] = useState<string | null>(null)

  const listQuery = useQuery(
    trpc.archiveInbox.list.queryOptions(
      {
        view,
        cursor,
        limit: 50,
        search: search || undefined,
        submissionId: submissionId || undefined,
        providerKey: providerKey === 'ALL' ? undefined : providerKey
      },
      {
        refetchInterval: (query) =>
          query.state.data?.items.some((item) => ACTIVE_STATUSES.has(item.status)) ? 3_000 : 8_000
      }
    )
  )
  const summaryQuery = useQuery(
    trpc.archiveInbox.summary.queryOptions(undefined, {
      refetchInterval: (query) => archiveIntakePollingInterval(query.state.data?.activeCount ?? 0)
    })
  )
  const dashboardQuery = useQuery(
    trpc.job.backgroundDashboard.queryOptions(undefined, {
      refetchInterval: (query) => archiveIntakePollingInterval(query.state.data?.activeCount ?? 0)
    })
  )
  const locatedItemQuery = useQuery(
    trpc.archiveInbox.list.queryOptions(
      { itemId: locatedItemId ?? undefined, view: 'ACTIVE', limit: 1 },
      { enabled: Boolean(locatedItemId), retry: false }
    )
  )
  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items])

  useEffect(() => {
    setSelection((current) => reconcileArchiveIntakeSelection(items, current))
  }, [items])

  useEffect(() => {
    setSelection(createEmptySelection())
  }, [view, cursor, search, submissionId, providerKey])

  const refreshInbox = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.archiveInbox.summary.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.job.backgroundDashboard.queryKey() })
    ])
  }
  const finishBulk = async (result: ArchiveBulkOperationView | null, message: string) => {
    if (!result) {
      toast.error('批量操作记录暂不可用，请刷新后重试')
      await refreshInbox()
      return
    }
    setOperation(result)
    toast.success(message, { description: bulkSummary(result) })
    await refreshInbox()
  }
  const enqueueMutation = useMutation(
    trpc.archiveInbox.enqueueMany.mutationOptions({
      onSuccess: (result, variables) => {
        releaseArchiveCommandKey(commandKeys.current, 'ENQUEUE', variables.items)
        void finishBulk(result, '所选项目已处理')
      },
      onError: (error) =>
        toast.error('归档入队失败', {
          description: archiveClientErrorMessage(error, '所选项目暂时无法入队，请稍后重试。')
        })
    })
  )
  const cancelMutation = useMutation(
    trpc.archiveInbox.cancelMany.mutationOptions({
      onSuccess: (result, variables) => {
        releaseArchiveCommandKey(commandKeys.current, 'CANCEL', variables.itemIds)
        void finishBulk(result, '取消请求已处理')
      },
      onError: (error) =>
        toast.error('取消失败', { description: archiveClientErrorMessage(error, '取消请求失败，请稍后重试。') })
    })
  )
  const retryMutation = useMutation(
    trpc.archiveInbox.retryMany.mutationOptions({
      onSuccess: (result, variables) => {
        releaseArchiveCommandKey(commandKeys.current, 'RETRY', variables.itemIds)
        void finishBulk(result, '重试请求已处理')
      },
      onError: (error) =>
        toast.error('重试失败', { description: archiveClientErrorMessage(error, '重试请求失败，请稍后再试。') })
    })
  )
  const pauseMutation = useMutation(
    trpc.archiveInbox.pause.mutationOptions({
      onSuccess: async () => {
        toast.success('解析队列已暂停')
        await refreshInbox()
      },
      onError: (error) =>
        toast.error('暂停失败', { description: archiveClientErrorMessage(error, '解析队列暂时无法暂停。') })
    })
  )
  const resumeMutation = useMutation(
    trpc.archiveInbox.resume.mutationOptions({
      onSuccess: async () => {
        toast.success('解析队列已恢复')
        await refreshInbox()
      },
      onError: (error) =>
        toast.error('恢复失败', { description: archiveClientErrorMessage(error, '解析队列暂时无法恢复。') })
    })
  )

  const actionCounts = countArchiveIntakeActions(items, selection.selectedIds)
  const selectableItems = items.filter(isSelectableIntakeItem)
  const allSelectableChecked =
    selectableItems.length > 0 && selectableItems.every((item) => selection.selectedIds.has(item.id))
  const anyMutationPending = enqueueMutation.isPending || cancelMutation.isPending || retryMutation.isPending

  const idempotencyKeyFor = (command: string, payload: unknown) => {
    // 批处理结果未确认前按 payload 指纹复用 key，让连点或网络重试落到同一份服务端审计记录。
    return getOrCreateArchiveCommandKey(
      commandKeys.current,
      command,
      payload,
      () => `archive-intake:${command.toLowerCase()}:${createBrowserUuid()}`
    )
  }

  const selectedForStatus = (statuses: ReadonlySet<string>) =>
    items.filter((item) => selection.selectedIds.has(item.id) && statuses.has(item.status))

  const enqueueSelected = () => {
    const selected = items
      .filter(
        (item) =>
          selection.selectedIds.has(item.id) &&
          item.status === 'READY' &&
          ['NEW', 'UPDATE', 'UNCHANGED'].includes(item.resolutionKind ?? '')
      )
      .slice(0, 100)
      .map((item) => ({ itemId: item.id, quality: selection.qualityById.get(item.id) ?? 'ORIGINAL' }))
    if (!selected.length) return
    enqueueMutation.mutate({ idempotencyKey: idempotencyKeyFor('ENQUEUE', selected), items: selected })
  }
  const retrySelected = () => {
    const itemIds = items
      .filter((item) => selection.selectedIds.has(item.id) && isRetryableIntakeItem(item))
      .slice(0, 100)
      .map((item) => item.id)
    if (!itemIds.length) return
    retryMutation.mutate({ idempotencyKey: idempotencyKeyFor('RETRY', itemIds), itemIds })
  }
  const cancelSelected = () => {
    const itemIds = selectedForStatus(new Set(['QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE']))
      .slice(0, 100)
      .map((item) => item.id)
    if (!itemIds.length) return
    cancelMutation.mutate({ idempotencyKey: idempotencyKeyFor('CANCEL', itemIds), itemIds })
  }

  const resetPaging = () => {
    setCursor(undefined)
    setPreviousCursors([])
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <ArchiveQueueControlPanel
        summary={summaryQuery.data}
        lanes={dashboardQuery.data?.lanes ?? []}
        loading={summaryQuery.isPending || dashboardQuery.isPending}
        error={summaryQuery.isError || dashboardQuery.isError}
        pausePending={pauseMutation.isPending || resumeMutation.isPending}
        onPause={() => pauseMutation.mutate()}
        onResume={() => resumeMutation.mutate()}
        onRetry={() => void refreshInbox()}
      />

      <Card>
        <CardHeader>
          <CardTitle>收件队列</CardTitle>
          <CardDescription>活动项按真实 FIFO 顺序排列；历史视图按最近更新时间排列。</CardDescription>
          <CardAction>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void refreshInbox()} disabled={listQuery.isFetching}>
                <RefreshCwIcon data-icon="inline-start" />
                刷新
              </Button>
              <ArchiveAddDialog
                trigger={
                  <Button size="sm">
                    <InboxIcon data-icon="inline-start" />
                    添加链接
                  </Button>
                }
              />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Tabs
            value={view}
            onValueChange={(nextView) => {
              setView(nextView as IntakeView)
              resetPaging()
            }}
          >
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="ACTIVE">待处理</TabsTrigger>
              <TabsTrigger value="FAILED">失败</TabsTrigger>
              <TabsTrigger value="ENQUEUED">已入队</TabsTrigger>
              <TabsTrigger value="CANCELLED">已取消 / 重复</TabsTrigger>
            </TabsList>
            <TabsContent value={view} className="flex flex-col gap-5">
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  setSearch(searchDraft.trim())
                  setSubmissionId(submissionDraft.trim())
                  resetPaging()
                }}
              >
                <FieldGroup className="gap-3 lg:flex-row lg:items-end">
                  <Field>
                    <FieldLabel htmlFor="archive-inbox-search">标题或链接</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id="archive-inbox-search"
                        name="archive-inbox-search"
                        value={searchDraft}
                        onChange={(event) => setSearchDraft(event.target.value)}
                        placeholder="搜索脱敏链接、标题或作品 ID…"
                        maxLength={500}
                        autoComplete="off"
                      />
                      <InputGroupAddon align="inline-end">
                        <SearchIcon />
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>
                  <Field className="lg:max-w-48">
                    <FieldLabel htmlFor="archive-inbox-provider">来源</FieldLabel>
                    <Select
                      value={providerKey}
                      onValueChange={(nextProvider) => {
                        setProviderKey(nextProvider)
                        resetPaging()
                      }}
                    >
                      <SelectTrigger id="archive-inbox-provider" className="w-full">
                        <SelectValue placeholder="全部来源" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="ALL">全部来源</SelectItem>
                          <SelectItem value="e-hentai">E-Hentai</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field className="lg:max-w-64">
                    <FieldLabel htmlFor="archive-inbox-submission">本次加入 ID</FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        id="archive-inbox-submission"
                        name="archive-inbox-submission"
                        value={submissionDraft}
                        onChange={(event) => setSubmissionDraft(event.target.value)}
                        placeholder="筛选本次加入 ID…"
                        maxLength={128}
                        autoComplete="off"
                      />
                    </InputGroup>
                  </Field>
                  <Button type="submit" variant="outline">
                    <ListFilterIcon data-icon="inline-start" />
                    应用筛选
                  </Button>
                </FieldGroup>
              </form>

              {selectableItems.length ? (
                <div className="sticky top-2 flex flex-col gap-3 rounded-lg border bg-background p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={allSelectableChecked ? true : selection.selectedIds.size > 0 ? 'indeterminate' : false}
                      onCheckedChange={(checked) => {
                        setSelection((current) => {
                          let next = current
                          for (const item of selectableItems) {
                            next = updateArchiveIntakeSelection(next, item.id, checked === true)
                          }
                          return next
                        })
                      }}
                      aria-label="选择当前页可操作项目"
                    />
                    已选择当前页 {selection.selectedIds.size} 项
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value="KEEP"
                      onValueChange={(quality) => {
                        if (quality === 'KEEP') return
                        setSelection((current) => {
                          const qualityById = new Map(current.qualityById)
                          for (const itemId of current.selectedIds) qualityById.set(itemId, quality as ArchiveQuality)
                          return { ...current, qualityById }
                        })
                      }}
                    >
                      <SelectTrigger size="sm">
                        <SelectValue placeholder="统一质量" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="KEEP">统一质量</SelectItem>
                          <SelectItem value="ORIGINAL">原图</SelectItem>
                          <SelectItem value="DISPLAY">展示图</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={enqueueSelected} disabled={!actionCounts.enqueue || anyMutationPending}>
                      {enqueueMutation.isPending ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <ArchiveIcon data-icon="inline-start" />
                      )}
                      入队 {actionCounts.enqueue}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={retrySelected}
                      disabled={!actionCounts.retry || anyMutationPending}
                    >
                      {retryMutation.isPending ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <RotateCcwIcon data-icon="inline-start" />
                      )}
                      重试 {actionCounts.retry}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setCancelConfirmationOpen(true)}
                      disabled={!actionCounts.cancel || anyMutationPending}
                    >
                      <Trash2Icon data-icon="inline-start" />
                      取消 {actionCounts.cancel}
                    </Button>
                  </div>
                </div>
              ) : null}

              {listQuery.isPending ? (
                <InboxLoading />
              ) : listQuery.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>收件队列加载失败</AlertTitle>
                  <AlertDescription>
                    <p>{archiveClientErrorMessage(listQuery.error, '收件队列暂时无法加载，请稍后重试。')}</p>
                    <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()}>
                      重新加载
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : items.length ? (
                <>
                  <DesktopIntakeTable
                    items={items}
                    selection={selection}
                    onSelectionChange={setSelection}
                    onReplace={setReplacementItemId}
                  />
                  <MobileIntakeList
                    items={items}
                    selection={selection}
                    onSelectionChange={setSelection}
                    onReplace={setReplacementItemId}
                  />
                </>
              ) : (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <InboxIcon />
                    </EmptyMedia>
                    <EmptyTitle>这个视图还没有项目</EmptyTitle>
                    <EmptyDescription>
                      {view === 'ACTIVE'
                        ? '添加链接后，解析项目会按顺序出现在这里。'
                        : '调整筛选或切换视图查看其他记录。'}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">每页最多 50 项；选择只作用于当前页。</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!previousCursors.length || listQuery.isFetching}
                    onClick={() => {
                      setPreviousCursors((current) => {
                        const next = [...current]
                        setCursor(next.pop())
                        return next
                      })
                    }}
                  >
                    <ArrowLeftIcon data-icon="inline-start" />
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!listQuery.data?.nextCursor || listQuery.isFetching}
                    onClick={() => {
                      if (!listQuery.data?.nextCursor) return
                      setPreviousCursors((current) => [...current, cursor])
                      setCursor(listQuery.data.nextCursor)
                    }}
                  >
                    下一页
                    <ArrowRightIcon data-icon="inline-end" />
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <AlertDialog open={cancelConfirmationOpen} onOpenChange={setCancelConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消 {actionCounts.cancel} 个收件项目？</AlertDialogTitle>
            <AlertDialogDescription>
              等待和就绪项目会停止处理；正在解析的项目会收到协作取消请求。其他不合法状态会逐项跳过。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>保留项目</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                setCancelConfirmationOpen(false)
                cancelSelected()
              }}
            >
              确认取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ArchiveBulkResultDialog operation={operation} onOpenChange={(open) => !open && setOperation(null)} />
      <ArchiveReplaceDialog
        itemId={replacementItemId}
        open={Boolean(replacementItemId)}
        onOpenChange={(open) => !open && setReplacementItemId(null)}
        onCreated={refreshInbox}
      />
      <LocatedIntakeItemDialog
        itemId={locatedItemId}
        item={locatedItemQuery.data?.items[0] ?? null}
        loading={locatedItemQuery.isPending}
        error={locatedItemQuery.isError}
        onReplace={(itemId) => setReplacementItemId(itemId)}
        onClose={() => router.replace(clearArchiveIntakeItemHref(searchParams.toString()), { scroll: false })}
      />
    </div>
  )
}

function LocatedIntakeItemDialog({
  itemId,
  item,
  loading,
  error,
  onReplace,
  onClose
}: {
  itemId: string | null
  item: IntakeItem | null
  loading: boolean
  error: boolean
  onReplace: (itemId: string) => void
  onClose: () => void
}) {
  return (
    <Dialog open={Boolean(itemId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>收件项目定位</DialogTitle>
          <DialogDescription>通过持久项目 ID 精确读取；下面只展示服务端返回的脱敏字段。</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>无法定位收件项目</AlertTitle>
            <AlertDescription>项目暂时无法读取，请刷新页面后重试。</AlertDescription>
          </Alert>
        ) : item ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <QueueMarker item={item} />
              <StatusBadge status={item.status} />
              <ResolutionBadge kind={item.resolutionKind} />
            </div>
            <ItemIdentity item={item} />
            <dl className="grid gap-4 border-y py-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">本次加入</dt>
                <dd className="mt-1">
                  <ArchiveSubmissionBadge submissionId={item.submissionId} />
                </dd>
              </div>
              <QueueDatum label="更新时间" value={formatTimestamp(item.updatedAt)} />
              <QueueDatum label="解析尝试" value={item.attempts} />
              <QueueDatum label="页面数" value={item.pageCount ?? '—'} />
            </dl>
            <div className="flex flex-wrap gap-2">
              {item.status === 'FAILED' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onClose()
                    onReplace(item.id)
                  }}
                >
                  <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                  修改并重试
                </Button>
              ) : null}
              {item.activeArchiveImportId || item.archiveImportId ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={archiveTaskHref(item.activeArchiveImportId || item.archiveImportId!)}>
                    打开关联任务
                    <ExternalLinkIcon data-icon="inline-end" />
                  </Link>
                </Button>
              ) : null}
              {item.duplicateOfItemId && item.duplicateOfItemId !== item.id ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={archiveIntakeItemHref(item.duplicateOfItemId)}>
                    打开首次项目
                    <ExternalLinkIcon data-icon="inline-end" />
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <InboxIcon />
              </EmptyMedia>
              <EmptyTitle>项目不存在</EmptyTitle>
              <EmptyDescription>该项目可能已超过保留期，或定位 ID 已失效。</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            关闭定位
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ArchiveQueueControlPanel({
  summary,
  lanes,
  loading,
  error,
  pausePending,
  onPause,
  onResume,
  onRetry
}: {
  summary: RouterOutputs['archiveInbox']['summary'] | undefined
  lanes: RouterOutputs['job']['backgroundDashboard']['lanes']
  loading: boolean
  error: boolean
  pausePending: boolean
  onPause: () => void
  onResume: () => void
  onRetry: () => void
}) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (error || !summary) {
    return (
      <Alert variant="destructive">
        <AlertTitle>解析控制面加载失败</AlertTitle>
        <AlertDescription>
          <p>无法确认容量、暂停状态或 Worker 通道，请刷新后再执行队列操作。</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            重新加载
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  const utilization = summary.capacity ? Math.round((summary.activeCount / summary.capacity) * 100) : 0
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          解析控制面
          <Badge variant={summary.paused ? 'warning' : 'success'}>{summary.paused ? '队列已暂停' : '持续领取'}</Badge>
        </CardTitle>
        <CardDescription>解析与媒体写入各占一个固定串行通道，二者可同时推进。</CardDescription>
        <CardAction>
          <Button size="sm" variant="outline" onClick={summary.paused ? onResume : onPause} disabled={pausePending}>
            {pausePending ? (
              <Spinner data-icon="inline-start" />
            ) : summary.paused ? (
              <CirclePlayIcon data-icon="inline-start" />
            ) : (
              <CirclePauseIcon data-icon="inline-start" />
            )}
            {summary.paused ? '恢复解析' : '暂停解析'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">活动容量</span>
            <span className="font-mono tabular-nums">
              {summary.activeCount} / {summary.capacity}
            </span>
          </div>
          <Progress value={utilization} aria-label={`收件箱容量已使用 ${utilization}%`} />
        </div>
        <dl className="grid gap-x-6 gap-y-4 border-y py-4 sm:grid-cols-2 lg:grid-cols-5">
          <QueueDatum label="等待" value={summary.queuedCount} />
          <QueueDatum label="当前解析" value={summary.currentItem ? `#${summary.currentItem.queueOrder}` : '空闲'} />
          <QueueDatum label="最老等待" value={formatAge(summary.oldestWaitingAt)} />
          <QueueDatum label="24h 失败" value={summary.recentFailedCount} />
          <QueueDatum label="剩余容量" value={summary.remainingCapacity} />
        </dl>
        {summary.currentItem ? (
          <div className="flex min-w-0 items-start gap-3 rounded-lg bg-muted/50 p-3">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse motion-reduce:animate-none" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{summary.currentItem.resolvedTitle || '正在解析远端作品'}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{summary.currentItem.submittedUrl}</p>
            </div>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {lanes.map((lane) => (
            <div key={lane.executionLane} className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-muted-foreground">
                  {lane.executionLane === 'ARCHIVE_RESOLVE' ? 'ARCHIVE_RESOLVE' : 'BACKGROUND_WRITER'}
                </p>
                <p className="truncate text-sm font-medium">
                  {lane.runningJob?.message ||
                    (lane.executionLane === 'ARCHIVE_RESOLVE' ? '链接与元数据解析' : '归档下载及媒体写入')}
                </p>
              </div>
              <LaneBadge status={lane.status} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function DesktopIntakeTable({
  items,
  selection,
  onSelectionChange,
  onReplace
}: {
  items: IntakeItem[]
  selection: ArchiveIntakeSelectionState
  onSelectionChange: React.Dispatch<React.SetStateAction<ArchiveIntakeSelectionState>>
  onReplace: (itemId: string) => void
}) {
  return (
    <AdminTableFrame className="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">选择</TableHead>
            <TableHead>队列</TableHead>
            <TableHead>作品</TableHead>
            <TableHead>判断</TableHead>
            <TableHead>状态 / 耗时</TableHead>
            <TableHead>质量 / 关联</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={item.id}
              id={`intake-${item.id}`}
              data-state={selection.selectedIds.has(item.id) ? 'selected' : undefined}
            >
              <TableCell>
                <Checkbox
                  checked={selection.selectedIds.has(item.id)}
                  disabled={!isSelectableIntakeItem(item)}
                  onCheckedChange={(checked) =>
                    onSelectionChange((current) => updateArchiveIntakeSelection(current, item.id, checked === true))
                  }
                  aria-label={`选择队列项目 ${item.queueOrder}`}
                />
              </TableCell>
              <TableCell>
                <QueueMarker item={item} />
              </TableCell>
              <TableCell className="max-w-sm whitespace-normal">
                <ItemIdentity item={item} />
              </TableCell>
              <TableCell>
                <ResolutionBadge kind={item.resolutionKind} />
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  <StatusBadge status={item.status} />
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{formatDuration(item)}</span>
                </div>
              </TableCell>
              <TableCell>
                <ItemQualityAndLink
                  item={item}
                  selection={selection}
                  onSelectionChange={onSelectionChange}
                  onReplace={onReplace}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AdminTableFrame>
  )
}

function MobileIntakeList({
  items,
  selection,
  onSelectionChange,
  onReplace
}: {
  items: IntakeItem[]
  selection: ArchiveIntakeSelectionState
  onSelectionChange: React.Dispatch<React.SetStateAction<ArchiveIntakeSelectionState>>
  onReplace: (itemId: string) => void
}) {
  return (
    <div className="flex flex-col md:hidden">
      {items.map((item) => (
        <article
          key={item.id}
          id={`intake-mobile-${item.id}`}
          className="grid grid-cols-[auto_1fr] gap-3 border-b py-4 last:border-b-0"
        >
          <div className="flex flex-col items-center gap-2 border-l-2 border-border pl-3">
            <Checkbox
              checked={selection.selectedIds.has(item.id)}
              disabled={!isSelectableIntakeItem(item)}
              onCheckedChange={(checked) =>
                onSelectionChange((current) => updateArchiveIntakeSelection(current, item.id, checked === true))
              }
              aria-label={`选择队列项目 ${item.queueOrder}`}
            />
            <QueueMarker item={item} />
          </div>
          <div className="min-w-0 flex flex-col gap-3">
            <ItemIdentity item={item} />
            <div className="flex flex-wrap items-center gap-2">
              <ResolutionBadge kind={item.resolutionKind} />
              <StatusBadge status={item.status} />
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{formatDuration(item)}</span>
            </div>
            <ItemQualityAndLink
              item={item}
              selection={selection}
              onSelectionChange={onSelectionChange}
              onReplace={onReplace}
            />
          </div>
        </article>
      ))}
    </div>
  )
}

function QueueMarker({ item }: { item: IntakeItem }) {
  return (
    <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
      {item.status === 'RESOLVING' ? (
        <span className="size-2 rounded-full bg-primary motion-safe:animate-pulse motion-reduce:animate-none" />
      ) : null}
      <span>#{item.queueOrder}</span>
    </div>
  )
}

function ItemIdentity({ item }: { item: IntakeItem }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium">{item.resolvedTitle || '等待解析标题'}</p>
      <p className="truncate font-mono text-xs text-muted-foreground">{item.submittedUrl}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {item.providerKey ? `${item.providerKey}${item.externalId ? ` #${item.externalId}` : ''}` : '等待识别来源'}
        {item.pageCount ? ` · ${item.pageCount} 页` : ''}
        {item.attempts ? ` · 尝试 ${item.attempts}` : ''}
      </p>
      <div className="mt-2">
        <ArchiveSubmissionBadge submissionId={item.submissionId} />
      </div>
      {item.errorMessage ? <p className="mt-1 line-clamp-2 text-xs text-destructive">{item.errorMessage}</p> : null}
    </div>
  )
}

function ItemQualityAndLink({
  item,
  selection,
  onSelectionChange,
  onReplace
}: {
  item: IntakeItem
  selection: ArchiveIntakeSelectionState
  onSelectionChange: React.Dispatch<React.SetStateAction<ArchiveIntakeSelectionState>>
  onReplace: (itemId: string) => void
}) {
  const canEnqueue = item.status === 'READY' && ['NEW', 'UPDATE', 'UNCHANGED'].includes(item.resolutionKind ?? '')
  const relatedTaskId = item.activeArchiveImportId || item.archiveImportId
  return (
    <div className="flex flex-wrap items-center gap-2">
      {item.status === 'FAILED' ? (
        <Button variant="outline" size="sm" onClick={() => onReplace(item.id)}>
          <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
          修改并重试
        </Button>
      ) : null}
      {canEnqueue ? (
        <Select
          value={selection.qualityById.get(item.id) ?? 'ORIGINAL'}
          onValueChange={(quality) =>
            onSelectionChange((current) => ({
              ...current,
              qualityById: new Map(current.qualityById).set(item.id, quality as ArchiveQuality)
            }))
          }
        >
          <SelectTrigger size="sm" aria-label={`队列项目 ${item.queueOrder} 的归档质量`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="ORIGINAL">原图</SelectItem>
              <SelectItem value="DISPLAY">展示图</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      ) : null}
      {relatedTaskId ? (
        <Button variant="link" size="sm" asChild>
          <Link href={archiveTaskHref(relatedTaskId)}>
            打开任务
            <ExternalLinkIcon data-icon="inline-end" />
          </Link>
        </Button>
      ) : item.duplicateOfItemId ? (
        <Button variant="link" size="sm" asChild>
          <Link href={archiveIntakeItemHref(item.duplicateOfItemId)}>
            打开首次项目
            <ExternalLinkIcon data-icon="inline-end" />
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

function QueueDatum({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-sm font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function LaneBadge({ status }: { status: 'RUNNING' | 'READY' | 'DRAINING' | 'ERROR' }) {
  const variant =
    status === 'ERROR' ? 'destructive' : status === 'DRAINING' ? 'warning' : status === 'RUNNING' ? 'info' : 'success'
  const label = { RUNNING: '运行中', READY: '就绪', DRAINING: '停止领取', ERROR: '异常' }[status]
  return <Badge variant={variant}>{label}</Badge>
}

function StatusBadge({ status }: { status: IntakeItem['status'] }) {
  const labels: Record<string, string> = {
    QUEUED: '等待解析',
    RESOLVING: '解析中',
    RETRY_WAIT: '等待重试',
    READY: '已就绪',
    STALE: '快照过期',
    FAILED: '解析失败',
    ENQUEUED: '已入队',
    CANCELLED: '已取消',
    DUPLICATE: '重复链接'
  }
  const variant =
    status === 'FAILED'
      ? 'destructive'
      : status === 'STALE' || status === 'RETRY_WAIT'
        ? 'warning'
        : status === 'RESOLVING'
          ? 'info'
          : status === 'READY' || status === 'ENQUEUED'
            ? 'success'
            : 'muted'
  return <Badge variant={variant}>{labels[status] ?? status}</Badge>
}

function ResolutionBadge({ kind }: { kind: IntakeItem['resolutionKind'] }) {
  if (!kind) return <Badge variant="muted">待判断</Badge>
  const labels = {
    NEW: '新归档',
    UPDATE: '新版本',
    UNCHANGED: '未变化',
    ACTIVE_TASK: '已有活动任务',
    DUPLICATE_IDENTITY: '作品身份重复'
  } as const
  const variant =
    kind === 'NEW'
      ? 'success'
      : kind === 'UPDATE'
        ? 'info'
        : kind === 'ACTIVE_TASK' || kind === 'DUPLICATE_IDENTITY'
          ? 'warning'
          : 'muted'
  return <Badge variant={variant}>{labels[kind as keyof typeof labels] ?? kind}</Badge>
}

function InboxLoading() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-[5rem_1fr_7rem] items-center gap-4 border-b pb-3 last:border-b-0 last:pb-0"
        >
          <Skeleton className="h-4 w-14" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  )
}

function formatDuration(item: IntakeItem) {
  const start = item.startedAt || item.createdAt
  const end = item.finishedAt || new Date()
  const milliseconds = Math.max(0, new Date(end).getTime() - new Date(start).getTime())
  if (milliseconds < 60_000) return `${Math.floor(milliseconds / 1_000)}s`
  if (milliseconds < 3_600_000) return `${Math.floor(milliseconds / 60_000)}m`
  return `${Math.floor(milliseconds / 3_600_000)}h ${Math.floor((milliseconds % 3_600_000) / 60_000)}m`
}

function formatAge(value: Date | string | null) {
  if (!value) return '—'
  const milliseconds = Math.max(0, Date.now() - new Date(value).getTime())
  if (milliseconds < 60_000) return '<1m'
  if (milliseconds < 3_600_000) return `${Math.floor(milliseconds / 60_000)}m`
  return `${Math.floor(milliseconds / 3_600_000)}h`
}

function formatTimestamp(value: Date | string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function bulkSummary(operation: ArchiveBulkOperationView) {
  return `创建 ${operation.counts.created} · 执行 ${operation.counts.applied} · 复用 ${operation.counts.reused} · 跳过 ${operation.counts.skipped} · 冲突 ${operation.counts.conflict} · 失败 ${operation.counts.failed}`
}
