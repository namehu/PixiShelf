'use client'

import Link from 'next/link'
import type { inferRouterOutputs } from '@trpc/server'
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { AppRouter } from '@/server'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { formatFullDate } from './scan-history-format'
import {
  formatSourceAuditApplyItemState,
  formatSourceAuditApplyStage,
  getSourceAuditApplyResultCopy,
  type SourceAuditApplyItemState,
  type SourceAuditApplyResult
} from './source-audit-view-state'

type RouterOutputs = inferRouterOutputs<AppRouter>
type SourceAuditApplyOperationOutput = NonNullable<RouterOutputs['sourceAudit']['getApplyOperation']>
type SourceAuditApplyOperationItem = SourceAuditApplyOperationOutput['items'][number]

const numberFormatter = new Intl.NumberFormat('zh-CN')

export function SourceAuditApplyOperation({
  operation,
  isPending,
  isFetching,
  isError,
  onRetry
}: {
  operation: SourceAuditApplyOperationOutput | null | undefined
  isPending: boolean
  isFetching: boolean
  isError: boolean
  onRetry: () => void
}) {
  if (isPending) {
    return (
      <Card aria-label="正在加载来源同步进度" aria-busy="true">
        <CardContent className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          正在恢复来源同步进度…
        </CardContent>
      </Card>
    )
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>无法加载来源同步进度</AlertTitle>
        <AlertDescription className="gap-3">
          <p>后台任务不会因此中断，可以重新加载进度。</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            重新加载
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (!operation) return null

  const progressTone =
    operation.status === 'FAILED'
      ? 'destructive'
      : operation.status === 'CANCELLED' || operation.status === 'SKIPPED'
        ? 'warning'
        : operation.terminal
          ? 'success'
          : 'default'
  const resultAttention = operation.counts.stale + operation.counts.conflict + operation.counts.failed

  return (
    <Card aria-labelledby="source-audit-apply-title">
      <span className="sr-only" aria-live="polite">
        {formatSourceAuditApplyStage(operation.stage)}，进度 {operation.progress}%
      </span>
      <CardHeader className="gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ApplyOperationStatusBadge status={operation.status} terminal={operation.terminal} />
            <Badge variant="outline">{formatSourceAuditApplyStage(operation.stage)}</Badge>
          </div>
          <CardTitle id="source-audit-apply-title" className="mt-2">
            所选来源同步
          </CardTitle>
          <CardDescription className="mt-1">
            {operation.terminal
              ? '逐项结果已保留，可在刷新页面后继续查看。'
              : 'Worker 正在逐项重新核验并同步；离开页面不会中断任务。'}
          </CardDescription>
        </div>
        <Button type="button" variant="outline" onClick={onRetry} disabled={isFetching}>
          {isFetching ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
          )}
          {isFetching ? '刷新中…' : '刷新进度'}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div>
          <div className="mb-2 flex items-center justify-between gap-4 text-sm">
            <span className="font-medium">{formatSourceAuditApplyStage(operation.stage)}</span>
            <span className="tabular-nums text-muted-foreground">{operation.progress}%</span>
          </div>
          <Progress
            value={operation.progress}
            indicatorVariant={progressTone}
            aria-label={`来源同步进度 ${operation.progress}%`}
          />
        </div>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4 xl:grid-cols-7">
          <OperationFact label="所选" value={operation.requested.total} />
          <OperationFact label="已应用" value={operation.counts.applied} tone="success" />
          <OperationFact label="无需同步" value={operation.counts.skipped} />
          <OperationFact
            label="来源变化"
            value={operation.counts.stale}
            tone={operation.counts.stale ? 'warning' : undefined}
          />
          <OperationFact
            label="状态冲突"
            value={operation.counts.conflict}
            tone={operation.counts.conflict ? 'warning' : undefined}
          />
          <OperationFact
            label="失败"
            value={operation.counts.failed}
            tone={operation.counts.failed ? 'destructive' : undefined}
          />
          <OperationFact label="处理中" value={operation.counts.pending + operation.counts.processing} />
        </dl>

        {operation.terminal && !operation.resultComplete ? (
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>逐项结果尚不完整</AlertTitle>
            <AlertDescription>任务已经停止，但部分结果仍在整理。请稍后刷新进度。</AlertDescription>
          </Alert>
        ) : operation.status === 'FAILED' ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>来源同步任务失败</AlertTitle>
            <AlertDescription>
              {resultAttention > 0 ? `${resultAttention} 项需要检查；` : ''}
              已经完成的逐项结果仍然保留，未完成项目没有被强行写入。
            </AlertDescription>
          </Alert>
        ) : operation.status === 'CANCELLED' || operation.status === 'SKIPPED' ? (
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>{operation.status === 'CANCELLED' ? '来源同步已取消' : '来源同步未执行'}</AlertTitle>
            <AlertDescription>已经完成的逐项结果仍然保留，未处理项目没有写入图库。</AlertDescription>
          </Alert>
        ) : operation.terminal && resultAttention > 0 ? (
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>{resultAttention} 项需要检查</AlertTitle>
            <AlertDescription>失败、来源变化和状态冲突都没有强行覆盖图库，可在下方查看处理建议。</AlertDescription>
          </Alert>
        ) : operation.terminal ? (
          <Alert variant="success">
            <CheckCircle2 aria-hidden="true" />
            <AlertTitle>所选来源已处理完成</AlertTitle>
            <AlertDescription>本次没有需要人工处理的冲突或失败。</AlertDescription>
          </Alert>
        ) : null}

        <div>
          <h3 className="text-sm font-semibold text-foreground">逐项结果</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            提交 {formatFullDate(operation.createdAt)} · 新增 {numberFormatter.format(operation.requested.new)} · 变化{' '}
            {numberFormatter.format(operation.requested.changed)}
          </p>
        </div>

        {operation.items.length > 0 ? (
          <>
            <div className="hidden overflow-hidden rounded-lg border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>结果</TableHead>
                    <TableHead>来源作品</TableHead>
                    <TableHead>metadata 路径</TableHead>
                    <TableHead>说明</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operation.items.map((item) => (
                    <ApplyOperationItemRow key={item.id} item={item} />
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col gap-3 md:hidden">
              {operation.items.map((item) => (
                <ApplyOperationItemCard key={item.id} item={item} />
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {operation.terminal ? '没有可显示的逐项结果。' : 'Worker 领取任务后会在这里显示逐项进度。'}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function OperationFact({
  label,
  value,
  tone
}: {
  label: string
  value: number
  tone?: 'success' | 'warning' | 'destructive'
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'destructive'
          ? 'text-destructive'
          : 'text-foreground'
  return (
    <div className="bg-background px-3 py-2.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 font-semibold tabular-nums ${toneClass}`}>{numberFormatter.format(value)}</dd>
    </div>
  )
}

function ApplyOperationStatusBadge({ status, terminal }: { status: string; terminal: boolean }) {
  const variant =
    status === 'FAILED'
      ? 'destructive'
      : status === 'COMPLETED'
        ? 'success'
        : status === 'CANCELLED'
          ? 'muted'
          : ['PAUSED', 'PAUSING', 'RETRY_WAIT'].includes(status)
            ? 'warning'
            : 'info'
  return <Badge variant={variant}>{terminal ? '任务已结束' : '任务执行中'}</Badge>
}

function ApplyOperationItemRow({ item }: { item: SourceAuditApplyOperationItem }) {
  return (
    <TableRow>
      <TableCell className="align-top">
        <ApplyResultBadge state={item.state} action={item.action} />
      </TableCell>
      <TableCell className="max-w-72 whitespace-normal align-top">
        <ApplyItemIdentity item={item} />
      </TableCell>
      <TableCell className="max-w-96 whitespace-normal align-top">
        <PrivacySensitiveText as="code" className="break-all text-xs text-muted-foreground">
          {item.metadataRelativePath}
        </PrivacySensitiveText>
      </TableCell>
      <TableCell className="max-w-80 whitespace-normal align-top">
        <ApplyItemMessage item={item} />
      </TableCell>
    </TableRow>
  )
}

function ApplyOperationItemCard({ item }: { item: SourceAuditApplyOperationItem }) {
  return (
    <Card className="gap-4 py-4 shadow-none">
      <CardHeader className="gap-2 px-4">
        <ApplyResultBadge state={item.state} action={item.action} />
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
        <ApplyItemMessage item={item} />
      </CardContent>
    </Card>
  )
}

function ApplyItemIdentity({ item }: { item: SourceAuditApplyOperationItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <PrivacySensitiveText className="break-words font-medium text-foreground">
        {item.title ?? item.artwork?.title ?? '未识别作品'}
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

function ApplyItemMessage({ item }: { item: SourceAuditApplyOperationItem }) {
  const fallback =
    item.state === 'PENDING' || item.state === 'PROCESSING'
      ? 'Worker 将逐项完成处理。'
      : getSourceAuditApplyResultCopy(item.state as SourceAuditApplyResult)
  return (
    <div className="flex flex-col gap-1">
      <PrivacySensitiveText className="leading-5 text-foreground">{item.summary ?? fallback}</PrivacySensitiveText>
      {item.retryable && item.state !== 'PENDING' && item.state !== 'PROCESSING' ? (
        <span className="text-xs text-muted-foreground">
          {item.state === 'STALE' || item.state === 'CONFLICT'
            ? '完成新的来源核对后可以重新选择本项。'
            : '修复问题后可以重新选择本项。'}
        </span>
      ) : null}
    </div>
  )
}

function ApplyResultBadge({
  state,
  action
}: {
  state: SourceAuditApplyItemState
  action: SourceAuditApplyOperationItem['action']
}) {
  const variant =
    state === 'APPLIED'
      ? 'success'
      : state === 'FAILED'
        ? 'destructive'
        : state === 'STALE' || state === 'CONFLICT'
          ? 'warning'
          : state === 'PROCESSING'
            ? 'info'
            : 'muted'
  return <Badge variant={variant}>{formatSourceAuditApplyItemState(state, action)}</Badge>
}
