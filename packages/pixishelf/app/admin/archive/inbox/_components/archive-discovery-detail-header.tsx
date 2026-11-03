'use client'

import { archiveTitleUploaderLabel } from '@pixishelf/job-contracts'
import type { inferRouterOutputs } from '@trpc/server'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChevronDownIcon,
  XIcon,
  CopyIcon,
  FingerprintIcon,
  HistoryIcon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UsersIcon
} from 'lucide-react'
import type { AppRouter } from '@/server'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  onCopyUid,
  onEditDefaultCreators,
  onEditRules,
  onCleanupCreators
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
  onEditDefaultCreators?: () => void
  onEditRules?: () => void
  onCleanupCreators?: () => void
}) {
  const progressCount = source.titleQuery ? (activeRun?.checkedCount ?? 0) : (activeRun?.itemCount ?? 0)

  return (
    <header className="flex min-w-0 flex-col gap-3" aria-label="发现来源详情">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="min-w-0 truncate text-base font-semibold">
              <PrivacySensitiveText className="min-w-0 truncate">{source.displayName}</PrivacySensitiveText>
            </h2>
            <Badge variant={source.status === 'ACTIVE' ? 'success' : 'muted'}>
              {source.status === 'ACTIVE' ? '已启用' : '已停用'}
            </Badge>
            {source.titleQuery?.uploaderName || (!source.titleQuery && source.uidBindingState === 'UNBOUND') ? (
              <Badge variant="secondary">按名称搜索</Badge>
            ) : null}
            {source.uidBindingState === 'REVALIDATION_REQUIRED' ? (
              <Badge variant="warning">扫描范围待核对</Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {source.titleQuery ? (
              <span className="min-w-0 break-words">
                远端标题关键词「
                <PrivacySensitiveText>{source.titleQuery.keyword}</PrivacySensitiveText>」 ·{' '}
                <PrivacySensitiveText>{archiveTitleUploaderLabel(source.titleQuery)}</PrivacySensitiveText>
              </span>
            ) : source.uploaderUid ? (
              <span>上传者 UID {source.uploaderUid}</span>
            ) : (
              <span>
                按名称：<PrivacySensitiveText>{source.identityValue}</PrivacySensitiveText>
              </span>
            )}
            <span>
              {latestRun
                ? `最近扫描 ${formatArchiveUploaderTimestamp(latestRun.createdAt)} · ${scanRunStatusLabel(latestRun.status)}`
                : '尚未运行扫描'}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {source.status === 'ACTIVE' ? (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-9"
                onClick={onScanLatest}
                disabled={Boolean(activeRun) || mutationPending}
              >
                {scanPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
                )}
                {source.hasPendingLatest ? '继续最新扫描' : '扫描最新'}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 sm:size-9"
                    aria-label="更多扫描操作"
                    disabled={Boolean(activeRun) || mutationPending}
                  >
                    <ChevronDownIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      className="min-h-11 sm:min-h-8"
                      onSelect={onScanHistory}
                      disabled={!source.canContinueHistory}
                    >
                      <HistoryIcon aria-hidden="true" />
                      扫描更早内容
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-11 sm:h-9"
              onClick={() => onSetArchived(false)}
              disabled={mutationPending}
            >
              <ArchiveRestoreIcon data-icon="inline-start" aria-hidden="true" />
              重新启用
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" className="h-11 sm:h-9">
                <Settings2Icon data-icon="inline-start" aria-hidden="true" />
                来源设置
                <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-52 [&_[data-slot=dropdown-menu-item]]:min-h-11 sm:[&_[data-slot=dropdown-menu-item]]:min-h-8"
            >
              <DropdownMenuGroup>
                {source.titleQuery ? (
                  <>
                    <DropdownMenuItem onSelect={onRename} disabled={mutationPending}>
                      <PencilIcon aria-hidden="true" />
                      修改名称
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onCopy} disabled={mutationPending}>
                      <SaveIcon aria-hidden="true" />
                      {source.titleQuery.uploaderName ? '另存为精确账号筛选' : '另存条件'}
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onSelect={onEditUid} disabled={Boolean(activeRun) || mutationPending}>
                    <FingerprintIcon aria-hidden="true" />
                    {source.uploaderUid ? '高级：更正上传者账号' : '识别上传者账号'}
                  </DropdownMenuItem>
                )}
                {!source.titleQuery && source.uploaderUid ? (
                  <DropdownMenuItem onSelect={onCopyUid}>
                    <CopyIcon aria-hidden="true" />
                    复制上传者 UID
                  </DropdownMenuItem>
                ) : null}
                {onEditDefaultCreators ? (
                  <DropdownMenuItem onSelect={onEditDefaultCreators} disabled={mutationPending}>
                    <UsersIcon aria-hidden="true" />
                    设置固定艺术家（{source.defaultCreators?.length ?? 0}）
                  </DropdownMenuItem>
                ) : null}
                {onEditRules ? (
                  <DropdownMenuItem onSelect={onEditRules} disabled={mutationPending}>
                    <SlidersHorizontalIcon aria-hidden="true" />
                    编辑接纳规则
                  </DropdownMenuItem>
                ) : null}
                {onCleanupCreators ? (
                  <DropdownMenuItem onSelect={onCleanupCreators} disabled={mutationPending}>
                    <UsersIcon aria-hidden="true" />
                    清理历史艺术家标记
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {source.status === 'ACTIVE' ? (
                  <DropdownMenuItem
                    onSelect={() => onSetArchived(true)}
                    disabled={Boolean(activeRun) || mutationPending}
                  >
                    <ArchiveIcon aria-hidden="true" />
                    停用来源
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => onSetArchived(false)} disabled={mutationPending}>
                    <ArchiveRestoreIcon aria-hidden="true" />
                    重新启用
                  </DropdownMenuItem>
                )}
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
      </div>
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
              className="h-11 sm:h-8"
              onClick={onCancel}
              disabled={cancelPending || cancelRequested}
            >
              {cancelPending || cancelRequested ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <XIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {cancelRequested ? '正在取消' : '取消扫描'}
            </Button>
          </div>
        </div>
      ) : null}

      <details className="text-sm">
        <summary className="w-fit cursor-pointer rounded-sm py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-1">
          扫描详情
        </summary>
        <div className="mt-2 flex flex-col gap-3 text-muted-foreground">
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
          </div>
          {latestRun ? (
            <p>
              {latestRun.mode === 'LATEST' ? '最新扫描' : '更早内容'} ·{' '}
              <PrivacySensitiveText>
                {scanIdentityLabel(latestRun.searchIdentityKind, latestRun.searchIdentityValue)}
              </PrivacySensitiveText>{' '}
              ·{' '}
              {source.titleQuery
                ? `检查 ${latestRun.checkedCount} 条，匹配 ${latestRun.matchedCount} 条`
                : `${latestRun.itemCount} 条`}
              {latestRun.stopReason ? ` · ${scanStopReasonLabel(latestRun.stopReason)}` : ''}
            </p>
          ) : null}
          {source.titleQuery ? (
            <p>
              仅筛选远端返回的标题，每批最多检查 100 条；零匹配不代表后面没有内容。可继续扫描更早内容，不会自动下载。
            </p>
          ) : null}
        </div>
      </details>
      {activeRun && !source.titleQuery ? (
        <p className="text-sm text-muted-foreground">扫描完成或取消后才能绑定或更正 UID。</p>
      ) : null}
    </header>
  )
}
