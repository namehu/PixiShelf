'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileQuestion,
  RefreshCw,
  SearchX,
  WandSparkles
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTRPC } from '@/lib/trpc'
import type { AppRouter } from '@/server'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { SourceAuditApplyDialog } from './source-audit-apply-dialog'
import { SourceAuditApplyOperation } from './source-audit-apply-operation'
import { formatDuration, formatFullDate } from './scan-history-format'
import {
  formatSourceAuditStatus,
  formatSourceAuditApplyResult,
  getOrCreateSourceAuditApplyKey,
  getSourceAuditApplyBlockedCopy,
  getSourceAuditApplyResultCopy,
  getSourceAuditClassificationMeta,
  getSourceAuditCount,
  getSourceAuditReasonCopy,
  shouldPollSourceAudit,
  shouldPollSourceAuditApply,
  countSourceAuditSelection,
  reconcileSourceAuditSelection,
  releaseSourceAuditApplyKey,
  resolveSourceAuditApplyOperationId,
  SOURCE_AUDIT_CLASSIFICATIONS,
  sourceAuditCurrentPageSelectionState,
  toggleSourceAuditCurrentPageSelection,
  toggleSourceAuditItemSelection,
  type SourceAuditClassification,
  type SourceAuditCounts,
  type SourceAuditFilter,
  type SourceAuditStatus,
  type SourceAuditSummaryClassification
} from './source-audit-view-state'

type RouterOutputs = inferRouterOutputs<AppRouter>
type SourceAuditSummary = NonNullable<RouterOutputs['sourceAudit']['get']>
type SourceAuditItem = RouterOutputs['sourceAudit']['listItems']['items'][number]

const numberFormatter = new Intl.NumberFormat('zh-CN')
const SUMMARY_CLASSIFICATIONS: SourceAuditSummaryClassification[] = [...SOURCE_AUDIT_CLASSIFICATIONS, 'UNCHANGED']

export function SourceAuditManagement({ auditRunId }: { auditRunId: string }) {
  const trpc = useTRPC()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [filter, setFilter] = useState<SourceAuditFilter>('ALL')
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([undefined])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const applyKeys = useRef(new Map<string, string>())
  const refreshedTerminalOperation = useRef<string | null>(null)
  const currentCursor = cursorHistory.at(-1)

  const auditQuery = useQuery(
    trpc.sourceAudit.get.queryOptions(
      { auditRunId },
      {
        refetchInterval: (query) => (shouldPollSourceAudit(query.state.data?.status) ? 2000 : false)
      }
    )
  )
  const audit = auditQuery.data
  const resultReady = audit?.status === 'COMPLETED' && audit.completed
  const itemsQuery = useQuery(
    trpc.sourceAudit.listItems.queryOptions(
      {
        auditRunId,
        classification: filter === 'ALL' ? undefined : filter,
        cursor: currentCursor,
        limit: 50
      },
      { enabled: resultReady }
    )
  )
  const items = useMemo(() => itemsQuery.data?.items ?? [], [itemsQuery.data?.items])

  const overviewQuery = useQuery(
    trpc.sourceAudit.getApplyOverview.queryOptions({ auditRunId }, { enabled: resultReady })
  )
  const operationParam = searchParams.get('operation')?.trim() ?? null
  const requestedOperationId = operationParam && operationParam.length <= 128 ? operationParam : null
  const operationId = resolveSourceAuditApplyOperationId(
    requestedOperationId,
    overviewQuery.data?.activeOperation?.operationId ?? null,
    overviewQuery.data?.latestOperation?.operationId ?? null
  )
  const operationQuery = useQuery(
    trpc.sourceAudit.getApplyOperation.queryOptions(
      { operationId: operationId ?? '__none__' },
      {
        enabled: resultReady && Boolean(operationId),
        refetchInterval: (query) => (shouldPollSourceAuditApply(query.state.data?.status) ? 2000 : false)
      }
    )
  )
  const operation = operationQuery.data?.auditRunId === auditRunId ? operationQuery.data : null
  const activeOperationId = overviewQuery.data?.activeOperation?.operationId ?? null
  const operationActive = Boolean(activeOperationId) || Boolean(operation && !operation.terminal)
  const eligibleIds = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.apply.state === 'ELIGIBLE' && (item.classification === 'NEW' || item.classification === 'CHANGED')
        )
        .map((item) => item.id),
    [items]
  )
  const selectionCounts = countSourceAuditSelection(items, selectedIds)
  const pageSelection = sourceAuditCurrentPageSelectionState(selectedIds, eligibleIds)
  const startApplyMutation = useMutation(trpc.sourceAudit.startApply.mutationOptions())

  useEffect(() => {
    setSelectedIds(new Set())
    setConfirmOpen(false)
    setApplyError(null)
  }, [auditRunId, filter, currentCursor])

  useEffect(() => {
    setSelectedIds((current) => reconcileSourceAuditSelection(current, eligibleIds))
  }, [eligibleIds])

  useEffect(() => {
    if (!operation?.terminal || refreshedTerminalOperation.current === operation.id) return
    refreshedTerminalOperation.current = operation.id
    setSelectedIds(new Set())
    void Promise.all([itemsQuery.refetch(), overviewQuery.refetch(), auditQuery.refetch()])
  }, [auditQuery, itemsQuery, operation, overviewQuery])

  const showOperation = (nextOperationId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('operation', nextOperationId)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const submitApply = async () => {
    const itemIds = [...selectedIds].sort()
    if (!itemIds.length) return
    setApplyError(null)
    const idempotencyKey = getOrCreateSourceAuditApplyKey(applyKeys.current, auditRunId, itemIds, () =>
      crypto.randomUUID()
    )

    try {
      const result = await startApplyMutation.mutateAsync({ auditRunId, itemIds, idempotencyKey })
      if (result.outcome === 'ACCEPTED') {
        releaseSourceAuditApplyKey(applyKeys.current, auditRunId, itemIds)
        setConfirmOpen(false)
        setSelectedIds(new Set())
        showOperation(result.operationId)
        void overviewQuery.refetch()
        return
      }

      if (result.reason === 'APPLY_ACTIVE' && result.activeOperationId) {
        releaseSourceAuditApplyKey(applyKeys.current, auditRunId, itemIds)
        setConfirmOpen(false)
        setSelectedIds(new Set())
        showOperation(result.activeOperationId)
        void overviewQuery.refetch()
        return
      }
      if (result.reason === 'IDEMPOTENCY_CONFLICT') {
        releaseSourceAuditApplyKey(applyKeys.current, auditRunId, itemIds)
      }
      setApplyError(getSourceAuditApplyBlockedCopy(result.reason))
      if (result.reason === 'ITEMS_NOT_ELIGIBLE') void itemsQuery.refetch()
    } catch {
      const recovered = await overviewQuery.refetch()
      const recoveredOperationId = recovered.data?.activeOperation?.operationId ?? null
      if (recoveredOperationId) {
        releaseSourceAuditApplyKey(applyKeys.current, auditRunId, itemIds)
        setConfirmOpen(false)
        setSelectedIds(new Set())
        showOperation(recoveredOperationId)
        return
      }
      setApplyError('提交结果暂时无法确认。请保持当前选择并再次确认，系统会复用同一个请求，不会重复创建任务。')
    }
  }

  const updateFilter = (nextFilter: SourceAuditFilter) => {
    setSelectedIds(new Set())
    setFilter(nextFilter)
    setCursorHistory([undefined])
  }

  if (auditQuery.isPending) return <SourceAuditSkeleton />

  if (auditQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>无法加载来源核对</AlertTitle>
        <AlertDescription className="gap-3">
          <p>请检查服务连接后重新加载；已有后台任务不会因此中断。</p>
          <Button type="button" variant="outline" size="sm" onClick={() => auditQuery.refetch()}>
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            重新加载
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (!audit) {
    return (
      <Empty className="min-h-80 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>没有找到这次来源核对</EmptyTitle>
          <EmptyDescription>记录可能已经按保留策略清理，或链接中的编号不完整。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const reasonCopy = getSourceAuditReasonCopy(audit.actionRequiredReason)
  const inProgress = shouldPollSourceAudit(audit.status)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <AuditStatusCard audit={audit} isRefreshing={auditQuery.isFetching} onRefresh={() => auditQuery.refetch()} />

      {reasonCopy ? (
        <Alert variant={audit.status === 'CANCELLED' ? 'default' : 'warning'}>
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{reasonCopy.title}</AlertTitle>
          <AlertDescription>{reasonCopy.description}</AlertDescription>
        </Alert>
      ) : null}

      {resultReady ? (
        <>
          <DifferenceSummary counts={audit.counts} filter={filter} onFilterChange={updateFilter} />
          {operationId || overviewQuery.isPending || overviewQuery.isError ? (
            overviewQuery.isError && !operationId ? (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>无法恢复来源同步记录</AlertTitle>
                <AlertDescription className="gap-3">
                  <p>差异结果仍然可浏览，请重新加载同步记录。</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => overviewQuery.refetch()}>
                    重新加载
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <SourceAuditApplyOperation
                operation={operation}
                isPending={overviewQuery.isPending || (Boolean(operationId) && operationQuery.isPending)}
                isFetching={operationQuery.isFetching}
                isError={operationQuery.isError}
                onRetry={() => operationQuery.refetch()}
              />
            )
          ) : null}
          {operationActive ? (
            <Alert variant="info" aria-live="polite">
              <WandSparkles aria-hidden="true" />
              <AlertTitle>来源同步正在执行</AlertTitle>
              <AlertDescription className="gap-3">
                <p>当前核对暂时不能再次选择，但仍可筛选和浏览全部差异。</p>
                {activeOperationId && activeOperationId !== operationId ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => showOperation(activeOperationId)}>
                    查看进行中的同步
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <AuditItemSection
            items={items}
            filter={filter}
            page={cursorHistory.length}
            isPending={itemsQuery.isPending}
            isFetching={itemsQuery.isFetching}
            isError={itemsQuery.isError}
            hasPrevious={cursorHistory.length > 1}
            hasNext={Boolean(itemsQuery.data?.nextCursor)}
            selectedIds={selectedIds}
            eligibleIds={eligibleIds}
            selectionState={pageSelection.checked}
            selectionDisabled={operationActive || startApplyMutation.isPending}
            onToggleItem={(itemId, checked) =>
              setSelectedIds((current) => toggleSourceAuditItemSelection(current, itemId, checked))
            }
            onToggleAll={(checked) =>
              setSelectedIds((current) => toggleSourceAuditCurrentPageSelection(current, eligibleIds, checked))
            }
            onShowAll={() => updateFilter('ALL')}
            onRetry={() => itemsQuery.refetch()}
            onPrevious={() => {
              setSelectedIds(new Set())
              setCursorHistory((history) => history.slice(0, -1))
            }}
            onNext={() => {
              const nextCursor = itemsQuery.data?.nextCursor
              if (nextCursor) {
                setSelectedIds(new Set())
                setCursorHistory((history) => [...history, nextCursor])
              }
            }}
          />
          {eligibleIds.length > 0 || selectionCounts.total > 0 ? (
            <SourceAuditSelectionBar
              counts={selectionCounts}
              disabled={operationActive || startApplyMutation.isPending}
              onClear={() => setSelectedIds(new Set())}
              onSubmit={() => {
                setApplyError(null)
                setConfirmOpen(true)
              }}
            />
          ) : null}
          <SourceAuditApplyDialog
            open={confirmOpen}
            counts={selectionCounts}
            pending={startApplyMutation.isPending}
            error={applyError}
            onOpenChange={(open) => {
              setConfirmOpen(open)
              if (!open) setApplyError(null)
            }}
            onConfirm={() => void submitApply()}
          />
        </>
      ) : reasonCopy ? null : inProgress ? (
        <AuditInProgress status={audit.status} />
      ) : (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>本次核对没有形成可用结果</AlertTitle>
          <AlertDescription>差异明细不会显示。请从扫描设置重新发起一次来源核对。</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function AuditStatusCard({
  audit,
  isRefreshing,
  onRefresh
}: {
  audit: SourceAuditSummary
  isRefreshing: boolean
  onRefresh: () => void
}) {
  const inProgress = shouldPollSourceAudit(audit.status)
  return (
    <Card>
      <CardHeader className="gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <AuditStatusBadge status={audit.status} />
            <Badge variant="outline">快速核对</Badge>
          </div>
          <CardTitle>Pixiv 来源快照</CardTitle>
          <CardDescription>
            {inProgress
              ? 'Worker 正在依次检查 metadata；离开页面不会中断任务。'
              : '这份结果只报告来源与图库清单的差异，没有修改作品或媒体文件。'}
          </CardDescription>
        </div>
        <Button type="button" variant="outline" onClick={onRefresh} disabled={isRefreshing}>
          {isRefreshing ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
          )}
          {isRefreshing ? '刷新中…' : '刷新状态'}
        </Button>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-4 border-t pt-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <AuditFact label="开始时间" value={formatFullDate(audit.startedAt)} />
          <AuditFact label="完成时间" value={audit.finishedAt ? formatFullDate(audit.finishedAt) : '—'} />
          <AuditFact label="检查工作量" value={`${numberFormatter.format(audit.work.candidates)} 个 metadata`} />
          <AuditFact
            label="读取内容"
            value={`${numberFormatter.format(audit.work.hashed)} 个 · 变化 ${numberFormatter.format(audit.work.changed)}`}
          />
        </dl>
        <p className="mt-4 text-xs tabular-nums text-muted-foreground">
          遍历 {numberFormatter.format(audit.work.walked)} 项 · 发现阶段{' '}
          {formatDuration(audit.work.discoveryDurationMs)} · 内容核对 {formatDuration(audit.work.hashDurationMs)}
        </p>
      </CardContent>
    </Card>
  )
}

function AuditFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-medium tabular-nums text-foreground" title={value}>
        {value}
      </dd>
    </div>
  )
}

function AuditStatusBadge({ status }: { status: SourceAuditStatus }) {
  const variant =
    status === 'COMPLETED'
      ? 'success'
      : status === 'FAILED'
        ? 'destructive'
        : ['PENDING', 'PAUSING', 'PAUSED', 'RETRY_WAIT'].includes(status)
          ? 'warning'
          : status === 'RUNNING' || status === 'CANCELLING'
            ? 'info'
            : 'muted'
  return <Badge variant={variant}>{formatSourceAuditStatus(status)}</Badge>
}

function DifferenceSummary({
  counts,
  filter,
  onFilterChange
}: {
  counts: SourceAuditCounts
  filter: SourceAuditFilter
  onFilterChange: (filter: SourceAuditFilter) => void
}) {
  return (
    <section aria-labelledby="source-audit-summary-title" className="flex flex-col gap-3">
      <div>
        <h2 id="source-audit-summary-title" className="text-base font-semibold text-foreground">
          差异摘要
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">选择一个差异类型筛选明细；再次选择可恢复全部差异。</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" role="group" aria-label="按差异类型筛选">
        {SUMMARY_CLASSIFICATIONS.map((classification) => {
          const meta = getSourceAuditClassificationMeta(classification)
          const count = getSourceAuditCount(counts, classification)

          if (classification === 'UNCHANGED') {
            return (
              <Card key={classification} className="gap-2 py-4 shadow-none">
                <CardHeader className="gap-1 px-4">
                  <CardTitle className="text-sm">{meta.label}</CardTitle>
                  <CardDescription className="text-xs leading-5">{meta.description}</CardDescription>
                </CardHeader>
                <CardContent className="px-4 text-2xl font-semibold tabular-nums text-foreground">
                  {numberFormatter.format(count)}
                </CardContent>
              </Card>
            )
          }

          const selected = filter === classification
          return (
            <Button
              key={classification}
              type="button"
              variant={selected ? 'secondary' : 'outline'}
              aria-pressed={selected}
              aria-label={`${selected ? '取消筛选' : '筛选'}${meta.label}，${numberFormatter.format(count)} 项`}
              onClick={() => onFilterChange(selected ? 'ALL' : classification)}
              className="h-auto min-h-28 flex-col items-stretch gap-1 whitespace-normal p-4 text-left"
            >
              <span className="text-sm font-semibold">{meta.label}</span>
              <strong className="text-2xl font-semibold tabular-nums">{numberFormatter.format(count)}</strong>
              <span className="text-xs leading-5 text-muted-foreground">{meta.description}</span>
            </Button>
          )
        })}
      </div>
    </section>
  )
}

function AuditItemSection({
  items,
  filter,
  page,
  isPending,
  isFetching,
  isError,
  hasPrevious,
  hasNext,
  selectedIds,
  eligibleIds,
  selectionState,
  selectionDisabled,
  onToggleItem,
  onToggleAll,
  onShowAll,
  onRetry,
  onPrevious,
  onNext
}: {
  items: SourceAuditItem[]
  filter: SourceAuditFilter
  page: number
  isPending: boolean
  isFetching: boolean
  isError: boolean
  hasPrevious: boolean
  hasNext: boolean
  selectedIds: ReadonlySet<string>
  eligibleIds: readonly string[]
  selectionState: boolean | 'indeterminate'
  selectionDisabled: boolean
  onToggleItem: (itemId: string, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
  onShowAll: () => void
  onRetry: () => void
  onPrevious: () => void
  onNext: () => void
}) {
  const filterLabel = filter === 'ALL' ? '全部差异' : getSourceAuditClassificationMeta(filter).label
  return (
    <Card>
      <CardHeader className="gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>差异明细</CardTitle>
            <Badge variant="outline">{filterLabel}</Badge>
          </div>
          <CardDescription className="mt-1">“来源缺失”只报告现状，不提供删除或解除关联操作。</CardDescription>
        </div>
        {filter !== 'ALL' ? (
          <Button type="button" variant="ghost" size="sm" onClick={onShowAll}>
            显示全部差异
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {eligibleIds.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
              <Checkbox
                checked={selectionState}
                disabled={selectionDisabled}
                onCheckedChange={(checked) => onToggleAll(checked === true)}
                aria-label="选择当前页可同步项目"
              />
              选择当前页可同步项目
            </label>
            <span className="text-xs text-muted-foreground">
              当前页 {numberFormatter.format(eligibleIds.length)} 项可同步，最多一次提交 50 项
            </span>
          </div>
        ) : null}
        {isError ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>无法加载差异明细</AlertTitle>
            <AlertDescription className="gap-3">
              <p>核对摘要仍然可用，请重新加载当前页。</p>
              <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                重新加载
              </Button>
            </AlertDescription>
          </Alert>
        ) : isPending ? (
          <AuditItemsSkeleton />
        ) : items.length === 0 ? (
          <Empty className="min-h-56 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CheckCircle2 aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{filter === 'ALL' ? '没有需要检查的差异' : `没有“${filterLabel}”项目`}</EmptyTitle>
              <EmptyDescription>
                {filter === 'ALL' ? '来源与图库清单一致。' : '可选择其他摘要分类，或恢复显示全部差异。'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="hidden md:block">
              <AuditItemTable
                items={items}
                selectedIds={selectedIds}
                selectionDisabled={selectionDisabled}
                onToggleItem={onToggleItem}
              />
            </div>
            <div className="flex flex-col gap-3 md:hidden">
              {items.map((item) => (
                <AuditItemCard
                  key={item.id}
                  item={item}
                  selected={selectedIds.has(item.id)}
                  selectionDisabled={selectionDisabled}
                  onToggleItem={onToggleItem}
                />
              ))}
            </div>
          </>
        )}

        {!isPending && !isError ? (
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              第 {page} 页 · 当前显示 {numberFormatter.format(items.length)} 项{isFetching ? ' · 正在更新…' : ''}
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" disabled={!hasPrevious || isFetching} onClick={onPrevious}>
                <ChevronLeft data-icon="inline-start" aria-hidden="true" />
                上一页
              </Button>
              <Button type="button" variant="outline" disabled={!hasNext || isFetching} onClick={onNext}>
                下一页
                <ChevronRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function AuditItemTable({
  items,
  selectedIds,
  selectionDisabled,
  onToggleItem
}: {
  items: SourceAuditItem[]
  selectedIds: ReadonlySet<string>
  selectionDisabled: boolean
  onToggleItem: (itemId: string, checked: boolean) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">
              <span className="sr-only">选择</span>
            </TableHead>
            <TableHead>类型</TableHead>
            <TableHead>来源作品</TableHead>
            <TableHead>metadata 路径</TableHead>
            <TableHead>说明</TableHead>
            <TableHead>同步状态</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} data-state={selectedIds.has(item.id) ? 'selected' : undefined}>
              <TableCell className="p-1 align-top">
                {item.apply.state === 'ELIGIBLE' ? (
                  <label className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                    <Checkbox
                      checked={selectedIds.has(item.id)}
                      disabled={selectionDisabled}
                      onCheckedChange={(checked) => onToggleItem(item.id, checked === true)}
                      aria-label={`选择${item.title ?? item.externalId ?? item.metadataRelativePath}`}
                    />
                  </label>
                ) : null}
              </TableCell>
              <TableCell className="align-top">
                <ClassificationBadge classification={item.classification} />
              </TableCell>
              <TableCell className="max-w-72 whitespace-normal align-top">
                <ArtworkIdentity item={item} />
              </TableCell>
              <TableCell className="max-w-96 whitespace-normal align-top">
                <PrivacySensitiveText as="code" className="break-all text-xs text-muted-foreground">
                  {item.metadataRelativePath}
                </PrivacySensitiveText>
              </TableCell>
              <TableCell className="max-w-80 whitespace-normal align-top">
                <DifferenceReason item={item} />
              </TableCell>
              <TableCell className="max-w-64 whitespace-normal align-top">
                <ItemApplyState item={item} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AuditItemCard({
  item,
  selected,
  selectionDisabled,
  onToggleItem
}: {
  item: SourceAuditItem
  selected: boolean
  selectionDisabled: boolean
  onToggleItem: (itemId: string, checked: boolean) => void
}) {
  return (
    <Card className="gap-4 py-4 shadow-none" data-state={selected ? 'selected' : undefined}>
      <CardHeader className="gap-2 px-4">
        <div className="flex items-start justify-between gap-3">
          <ClassificationBadge classification={item.classification} />
          {item.apply.state === 'ELIGIBLE' ? (
            <label className="-m-2 flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
              <Checkbox
                checked={selected}
                disabled={selectionDisabled}
                onCheckedChange={(checked) => onToggleItem(item.id, checked === true)}
                aria-label={`选择${item.title ?? item.externalId ?? item.metadataRelativePath}`}
              />
            </label>
          ) : null}
        </div>
        <PrivacySensitiveText as={CardTitle} className="break-words text-sm leading-5">
          {item.title ?? item.artwork?.title ?? (item.externalId ? `Pixiv #${item.externalId}` : '未识别来源作品')}
        </PrivacySensitiveText>
        <PrivacySensitiveText as={CardDescription} className="break-words">
          {item.artistName ?? '作者未知'}
        </PrivacySensitiveText>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">metadata 路径</p>
          <PrivacySensitiveText as="code" className="mt-1 block break-all text-xs text-foreground">
            {item.metadataRelativePath}
          </PrivacySensitiveText>
        </div>
        <DifferenceReason item={item} />
        <ItemApplyState item={item} />
      </CardContent>
    </Card>
  )
}

function ItemApplyState({ item }: { item: SourceAuditItem }) {
  const applyMeta =
    item.apply.state === 'ELIGIBLE'
      ? {
          label: item.apply.action === 'IMPORT' ? '可导入' : '可同步',
          variant: item.apply.action === 'IMPORT' ? ('info' as const) : ('warning' as const),
          description: item.apply.action === 'IMPORT' ? '可作为新作品导入图库。' : '可同步这次发现的来源变化。'
        }
      : {
          NOT_APPLICABLE: {
            label: '只读差异',
            variant: 'muted' as const,
            description: '该差异仅供检查，不提供写操作。'
          },
          IN_PROGRESS: {
            label: '同步中',
            variant: 'info' as const,
            description: '已有来源同步正在处理本项。'
          },
          ALREADY_APPLIED: {
            label: '已处理',
            variant: 'success' as const,
            description: '这次核对中的项目已经处理。'
          },
          REQUIRES_NEW_AUDIT: {
            label: '需要重新核对',
            variant: 'warning' as const,
            description: '当前快照已不再适合写入，请重新运行来源核对。'
          }
        }[item.apply.state]

  const latest = item.latestApplyResult
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Badge variant={applyMeta.variant}>{applyMeta.label}</Badge>
      <span className="text-xs leading-5 text-muted-foreground">{applyMeta.description}</span>
      {latest ? (
        <span className="text-xs leading-5 text-muted-foreground">
          最近结果：{formatSourceAuditApplyResult(latest.result, latest.action)}。{' '}
          {latest.summary ?? getSourceAuditApplyResultCopy(latest.result)}
        </span>
      ) : null}
    </div>
  )
}

function ArtworkIdentity({ item }: { item: SourceAuditItem }) {
  const title = item.title ?? item.artwork?.title ?? null
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <PrivacySensitiveText className="break-words font-medium text-foreground">
        {title ?? '未识别作品'}
      </PrivacySensitiveText>
      <PrivacySensitiveText className="break-words text-xs text-muted-foreground">
        {item.artistName ?? '作者未知'}
        {item.externalId ? ` · Pixiv #${item.externalId}` : ''}
      </PrivacySensitiveText>
      {item.artwork ? (
        <Button asChild variant="link" size="sm" className="h-auto w-fit p-0">
          <Link href={`/artworks/${item.artwork.id}`} target="_blank" rel="noreferrer">
            查看图库作品
          </Link>
        </Button>
      ) : null}
    </div>
  )
}

function DifferenceReason({ item }: { item: SourceAuditItem }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <PrivacySensitiveText className="leading-5 text-foreground">
        {item.reasonSummary ?? item.reasonCode ?? getSourceAuditClassificationMeta(item.classification).description}
      </PrivacySensitiveText>
      {item.expectedExternalId || item.observedExternalId ? (
        <span className="text-xs text-muted-foreground">
          预期 {item.expectedExternalId ?? '—'} · 实际 {item.observedExternalId ?? '—'}
        </span>
      ) : null}
    </div>
  )
}

function ClassificationBadge({ classification }: { classification: SourceAuditClassification }) {
  const meta = getSourceAuditClassificationMeta(classification)
  return <Badge variant={meta.tone}>{meta.label}</Badge>
}

function AuditInProgress({ status }: { status: SourceAuditStatus }) {
  const paused = status === 'PAUSED'
  return (
    <Empty className="min-h-72 border" aria-live="polite">
      <EmptyHeader>
        <EmptyMedia variant="icon">{paused ? <FileQuestion aria-hidden="true" /> : <Spinner />}</EmptyMedia>
        <EmptyTitle>{paused ? '来源核对已暂停' : formatSourceAuditStatus(status)}</EmptyTitle>
        <EmptyDescription>
          {paused
            ? '可前往后台任务继续或取消；恢复后本页面会自动更新。'
            : '任务在后台队列中按顺序执行。可以安全离开页面，稍后从扫描历史继续查看。'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function SourceAuditSelectionBar({
  counts,
  disabled,
  onClear,
  onSubmit
}: {
  counts: { total: number; new: number; changed: number }
  disabled: boolean
  onClear: () => void
  onSubmit: () => void
}) {
  return (
    <section
      className="sticky bottom-[calc(var(--app-mobile-navigation-offset)+0.75rem)] z-20 flex flex-col gap-3 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:flex-row sm:items-center sm:justify-between lg:bottom-4"
      aria-label="当前页来源同步选择"
      aria-live="polite"
    >
      <div className="flex min-h-11 flex-wrap items-center gap-2">
        <Badge>{counts.total}</Badge>
        <span className="text-sm font-medium">已选择当前页项目</span>
        {counts.new > 0 ? <span className="text-xs text-muted-foreground">新增 {counts.new}</span> : null}
        {counts.changed > 0 ? <span className="text-xs text-muted-foreground">变化 {counts.changed}</span> : null}
        <Button type="button" variant="ghost" size="sm" disabled={disabled || counts.total === 0} onClick={onClear}>
          清除选择
        </Button>
      </div>
      <Button type="button" className="min-h-11" disabled={disabled || counts.total === 0} onClick={onSubmit}>
        <WandSparkles data-icon="inline-start" aria-hidden="true" />
        同步所选来源{counts.total > 0 ? `（${counts.total}）` : ''}
      </Button>
    </section>
  )
}

function SourceAuditSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6" aria-label="正在加载来源核对" aria-busy="true">
      <Card>
        <CardHeader className="gap-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-4 max-w-xl" />
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-12" />
          ))}
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <Skeleton key={item} className="h-28" />
        ))}
      </div>
    </div>
  )
}

function AuditItemsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-label="正在加载差异明细" aria-busy="true">
      {[0, 1, 2, 3, 4].map((item) => (
        <Skeleton key={item} className="h-16" />
      ))}
    </div>
  )
}

export function SourceAuditBackLink() {
  return (
    <Button asChild variant="outline">
      <Link href="/admin/scan-history">
        <ArrowLeft data-icon="inline-start" aria-hidden="true" />
        返回扫描历史
      </Link>
    </Button>
  )
}
