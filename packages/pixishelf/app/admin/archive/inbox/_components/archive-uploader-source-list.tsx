'use client'

import { ARCHIVE_TITLE_MATCH_LABELS } from '@pixishelf/job-contracts'
import type { inferRouterOutputs } from '@trpc/server'
import { CopyIcon, MoreHorizontalIcon } from 'lucide-react'
import type { AppRouter } from '@/server'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
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
import {
  formatArchiveUploaderTimestamp,
  isActiveArchiveUploaderRunStatus,
  scanRunStatusLabel
} from './archive-uploader-view-state'

type UploaderSource = inferRouterOutputs<AppRouter>['archiveSearch']['listSources'][number]

export function ArchiveUploaderSourceList({
  sources,
  onSelect,
  onCopyUid,
  checkedSourceIds,
  onCheckSource,
  selectionDisabled,
  onSetArchived,
  onDelete
}: {
  checkedSourceIds?: Set<string>
  onCheckSource?: (id: string, checked: boolean) => void
  selectionDisabled?: boolean
  sources: UploaderSource[]
  selectedSourceId: string | null
  onSelect: (sourceId: string) => void
  onCopyUid: (uploaderUid: string) => void
  onSetArchived?: (sourceId: string, archived: boolean) => void
  onDelete?: (sourceId: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border" aria-label="已保存来源">
      <div
        aria-hidden="true"
        className="hidden grid-cols-[2rem_minmax(0,1fr)_2.5rem] gap-3 bg-muted/40 px-4 py-3 text-xs text-muted-foreground lg:grid"
      >
        <span />
        <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_8rem_10rem] gap-4 px-2">
          <span>来源与条件</span>
          <span>待处理</span>
          <span>异常</span>
          <span>扫描状态</span>
          <span>最近扫描</span>
        </div>
        <span />
      </div>
      {sources.map((source) => (
        <div
          key={source.id}
          className="flex items-center gap-2 border-t px-3 first:border-t-0 hover:bg-muted/30 lg:gap-3 lg:px-4"
        >
          {onCheckSource ? (
            <span className="flex w-8 shrink-0 justify-center">
              <Checkbox
                aria-label={`选择来源 ${source.displayName}`}
                checked={checkedSourceIds?.has(source.id) ?? false}
                disabled={
                  selectionDisabled ||
                  source.status !== 'ACTIVE' ||
                  isActiveArchiveUploaderRunStatus(source.latestRun?.status)
                }
                onCheckedChange={(checked) => onCheckSource(source.id, checked === true)}
              />
            </span>
          ) : null}
          <Button
            variant="ghost"
            className="grid h-auto min-h-24 min-w-0 flex-1 grid-cols-2 justify-start gap-x-4 gap-y-2 px-2 py-4 text-left lg:min-h-20 lg:grid-cols-[minmax(0,1fr)_5rem_5rem_8rem_10rem]"
            onClick={() => onSelect(source.id)}
            data-source-id={source.id}
          >
            <span className="col-span-2 min-w-0 lg:col-span-1">
              <span className="flex items-center gap-2">
                <PrivacySensitiveText className="truncate font-medium">{source.displayName}</PrivacySensitiveText>
                <Badge variant="secondary">{source.titleQuery ? '关键词' : '上传者'}</Badge>
                {source.status === 'ARCHIVED' ? <Badge variant="muted">已停用</Badge> : null}
              </span>
              <PrivacySensitiveText className="mt-1 block truncate text-xs font-normal text-muted-foreground">
                {source.titleQuery
                  ? `标题${ARCHIVE_TITLE_MATCH_LABELS[source.titleQuery.matchMode]}「${source.titleQuery.keyword}」${source.titleQuery.uploaderName ? ` · ${source.titleQuery.uploaderName}` : source.titleQuery.uploaderUid ? ` · UID ${source.titleQuery.uploaderUid}` : ''}`
                  : source.uploaderUid
                    ? `UID ${source.uploaderUid}`
                    : `按名称：${source.identityValue}`}
              </PrivacySensitiveText>
            </span>
            <span className="flex items-center gap-1 tabular-nums">
              <span className="text-xs font-normal text-muted-foreground lg:hidden">待处理</span>
              {source.catalogCounts ? (
                source.catalogCounts.actionable
              ) : (
                <Skeleton className="h-4 w-8" aria-label="待处理数量加载中" />
              )}
            </span>
            <span className="flex items-center gap-1 tabular-nums">
              <span className="text-xs font-normal text-muted-foreground lg:hidden">异常</span>
              {source.catalogCounts ? (
                source.catalogCounts.attention > 0 ? (
                  <Badge variant="warning">{source.catalogCounts.attention}</Badge>
                ) : (
                  '0'
                )
              ) : (
                <Skeleton className="h-4 w-8" aria-label="异常数量加载中" />
              )}
            </span>
            <span className="min-w-0 whitespace-normal text-xs font-normal">
              {source.uidBindingState === 'REVALIDATION_REQUIRED' ? (
                <Badge variant="warning">扫描范围待核对</Badge>
              ) : source.latestRun ? (
                scanRunStatusLabel(source.latestRun.status)
              ) : (
                '未扫描'
              )}
            </span>
            <span className="whitespace-normal text-xs font-normal text-muted-foreground">
              {source.lastScanAt ? formatArchiveUploaderTimestamp(source.lastScanAt) : '尚未扫描'}
            </span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`更多来源操作 ${source.displayName}`}>
                <MoreHorizontalIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => onSelect(source.id)}>查看来源</DropdownMenuItem>
                {source.uploaderUid ? (
                  <DropdownMenuItem onSelect={() => onCopyUid(source.uploaderUid!)}>
                    <CopyIcon aria-hidden="true" />
                    复制 UID
                  </DropdownMenuItem>
                ) : null}
                {onSetArchived ? (
                  <DropdownMenuItem
                    disabled={isActiveArchiveUploaderRunStatus(source.latestRun?.status)}
                    onSelect={() => onSetArchived(source.id, source.status === 'ACTIVE')}
                  >
                    {source.status === 'ACTIVE' ? '停用来源' : '重新启用'}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
              {onDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(source.id)}>
                      删除来源
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </div>
  )
}
