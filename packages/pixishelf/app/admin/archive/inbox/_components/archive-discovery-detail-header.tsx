'use client'

import { ARCHIVE_TITLE_MATCH_LABELS } from '@pixishelf/job-contracts'
import type { inferRouterOutputs } from '@trpc/server'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CircleStopIcon,
  CopyIcon,
  FingerprintIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon
} from 'lucide-react'
import type { AppRouter } from '@/server'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import {
  formatArchiveUploaderTimestamp,
  historyCoverageLabel,
  latestCoverageLabel,
  scanIdentityLabel,
  scanRunStatusLabel,
  scanStopReasonLabel
} from './archive-uploader-view-state'

type RouterOutputs = inferRouterOutputs<AppRouter>
type DiscoverySource = RouterOutputs['archiveSearch']['getSource']['source']
type DiscoveryRun = RouterOutputs['archiveSearch']['getSource']['runs'][number]

export function ArchiveDiscoveryDetailHeader({
  source,
  activeRun,
  latestRun,
  mutationPending,
  scanPending,
  cancelPending,
  cancelRequested,
  onScanLatest,
  onScanHistory,
  onCancel,
  onSetArchived,
  onRename,
  onCopy,
  onEditUid,
  onDelete,
  onCopyUid
}: {
  source: DiscoverySource
  activeRun?: DiscoveryRun
  latestRun?: DiscoveryRun
  mutationPending: boolean
  scanPending: boolean
  cancelPending: boolean
  cancelRequested: boolean
  onScanLatest: () => void
  onScanHistory: () => void
  onCancel: () => void
  onSetArchived: (archived: boolean) => void
  onRename: () => void
  onCopy: () => void
  onEditUid: () => void
  onDelete: () => void
  onCopyUid: () => void
}) {
  const progressCount = source.titleQuery ? (activeRun?.checkedCount ?? 0) : (activeRun?.itemCount ?? 0)

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="gap-2 px-4 sm:px-6">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <PrivacySensitiveText className="min-w-0 truncate">{source.displayName}</PrivacySensitiveText>
              <Badge variant={source.status === 'ACTIVE' ? 'success' : 'muted'}>
                {source.status === 'ACTIVE' ? '已启用' : '已停用'}
              </Badge>
              {!source.titleQuery && source.uidBindingState === 'UNBOUND' ? (
                <Badge variant="warning">未绑定 UID</Badge>
              ) : null}
              {source.uidBindingState === 'REVALIDATION_REQUIRED' ? <Badge variant="warning">UID 待校验</Badge> : null}
            </CardTitle>
            <CardDescription className="mt-2 flex flex-wrap items-center gap-1.5">
              {source.titleQuery ? (
                <span>
                  标题{ARCHIVE_TITLE_MATCH_LABELS[source.titleQuery.matchMode]}「
                  <PrivacySensitiveText>{source.titleQuery.keyword}</PrivacySensitiveText>」 ·{' '}
                  {source.titleQuery.uploaderUid ? `UID ${source.titleQuery.uploaderUid}` : '不限上传者'}
                </span>
              ) : source.uploaderUid ? (
                <>
                  <span>上传者 UID {source.uploaderUid}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label="复制上传者 UID"
                    onClick={onCopyUid}
                  >
                    <CopyIcon aria-hidden="true" />
                  </Button>
                </>
              ) : (
                <span>
                  按名称：<PrivacySensitiveText>{source.identityValue}</PrivacySensitiveText>
                </span>
              )}
            </CardDescription>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" aria-label="更多来源操作">
                <MoreHorizontalIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuGroup>
                {source.titleQuery ? (
                  <>
                    <DropdownMenuItem onSelect={onRename} disabled={mutationPending}>
                      <PencilIcon aria-hidden="true" />
                      修改名称
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onCopy} disabled={mutationPending}>
                      <SaveIcon aria-hidden="true" />
                      另存条件
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onSelect={onEditUid} disabled={Boolean(activeRun) || mutationPending}>
                    <FingerprintIcon aria-hidden="true" />
                    {source.uploaderUid ? '更正 UID' : '绑定 UID'}
                  </DropdownMenuItem>
                )}
                {source.status === 'ACTIVE' ? (
                  <DropdownMenuItem
                    onSelect={() => onSetArchived(true)}
                    disabled={Boolean(activeRun) || mutationPending}
                  >
                    <ArchiveIcon aria-hidden="true" />
                    停用来源
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem variant="destructive" onSelect={onDelete} disabled={mutationPending}>
                  <Trash2Icon aria-hidden="true" />
                  删除来源
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 sm:px-6">
        {activeRun ? (
          <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3" aria-label="当前扫描进度">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Spinner aria-hidden="true" />
                {activeRun.mode === 'LATEST' ? '正在扫描最新' : '正在扫描更早内容'}
              </span>
              <Badge variant="warning">{scanRunStatusLabel(activeRun.status)}</Badge>
            </div>
            <Progress value={Math.min(100, progressCount)} aria-label={`已检查 ${progressCount} 条`} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                已检查 {progressCount} 条{source.titleQuery ? ` · 匹配 ${activeRun.matchedCount} 条` : ''}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onCancel}
                disabled={cancelPending || cancelRequested}
              >
                {cancelPending || cancelRequested ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <CircleStopIcon data-icon="inline-start" aria-hidden="true" />
                )}
                {cancelRequested ? '正在取消' : '取消扫描'}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {source.status === 'ACTIVE' ? (
            <>
              <Button type="button" onClick={onScanLatest} disabled={Boolean(activeRun) || mutationPending}>
                {scanPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
                )}
                {source.hasPendingLatest ? '继续最新扫描' : '扫描最新'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onScanHistory}
                disabled={!source.canContinueHistory || Boolean(activeRun) || mutationPending}
              >
                <HistoryIcon data-icon="inline-start" aria-hidden="true" />
                扫描更早内容
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={() => onSetArchived(false)} disabled={mutationPending}>
              <ArchiveRestoreIcon data-icon="inline-start" aria-hidden="true" />
              重新启用
            </Button>
          )}
        </div>

        <details className="rounded-md border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">扫描覆盖与最近运行</summary>
          <div className="mt-3 flex flex-col gap-3 text-muted-foreground">
            <div className="flex flex-wrap gap-2" aria-label="扫描覆盖状态">
              {source.uidBindingState === 'REVALIDATION_REQUIRED' ? (
                <Badge variant="warning">UID 覆盖：待重新验证</Badge>
              ) : (
                <>
                  <Badge variant={source.latestCoverage === 'HAS_MORE' ? 'warning' : 'muted'}>
                    最新：{latestCoverageLabel(source.latestCoverage)}
                  </Badge>
                  <Badge variant={source.historyCoverage === 'HAS_MORE' ? 'info' : 'muted'}>
                    历史：{historyCoverageLabel(source.historyCoverage)}
                  </Badge>
                </>
              )}
              <Badge variant={source.catalogCounts.actionable > 0 ? 'success' : 'muted'}>
                待处理 {source.catalogCounts.actionable}
              </Badge>
              {source.catalogCounts.processing > 0 ? (
                <Badge variant="warning">处理中 {source.catalogCounts.processing}</Badge>
              ) : null}
            </div>
            {latestRun ? (
              <p>
                最近运行 · {latestRun.mode === 'LATEST' ? '最新扫描' : '更早内容'} ·{' '}
                <PrivacySensitiveText>
                  {scanIdentityLabel(latestRun.searchIdentityKind, latestRun.searchIdentityValue)}
                </PrivacySensitiveText>{' '}
                · {formatArchiveUploaderTimestamp(latestRun.createdAt)} · {scanRunStatusLabel(latestRun.status)} ·{' '}
                {source.titleQuery
                  ? `检查 ${latestRun.checkedCount} 条，匹配 ${latestRun.matchedCount} 条`
                  : `${latestRun.itemCount} 条`}
                {latestRun.stopReason ? ` · ${scanStopReasonLabel(latestRun.stopReason)}` : ''}
              </p>
            ) : (
              <p>尚未运行扫描。</p>
            )}
          </div>
        </details>
        {activeRun && !source.titleQuery ? (
          <p className="text-sm text-muted-foreground">扫描完成或取消后才能绑定或更正 UID。</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
