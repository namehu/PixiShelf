'use client'

import { ARCHIVE_TITLE_MATCH_LABELS } from '@pixishelf/job-contracts'
import type { inferRouterOutputs } from '@trpc/server'
import { CopyIcon, MoreHorizontalIcon } from 'lucide-react'
import { ArchiveDiscoveryResultList, type ArchiveDiscoveryListPosition } from './archive-discovery-result-list'
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

const noop = () => {}

export function ArchiveUploaderSourceList({
  sources,
  positionKey = 'sources',
  position,
  onPositionChange = noop,
  focusSourceId,
  onSelect,
  onCopyUid,
  checkedSourceIds,
  onCheckSource,
  selectionDisabled,
  onSetArchived,
  onDelete
}: {
  positionKey?: string
  position?: ArchiveDiscoveryListPosition
  onPositionChange?: (position: ArchiveDiscoveryListPosition) => void
  focusSourceId?: string | null
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
    <section aria-label="已保存来源">
      <ArchiveDiscoveryResultList
        items={sources}
        isDesktop={false}
        layoutReady
        isLoading={false}
        isError={false}
        errorTitle="来源加载失败"
        errorDescription=""
        emptyState={null}
        header={null}
        footer={null}
        hasNextPage={false}
        isFetchingNextPage={false}
        onLoadMore={noop}
        onRetry={noop}
        positionKey={positionKey}
        position={position}
        onPositionChange={onPositionChange}
        onPositionRestored={() => {
          if (focusSourceId && document.activeElement === document.body) {
            Array.from(document.querySelectorAll<HTMLButtonElement>('[data-source-id]'))
              .find((element) => element.dataset.sourceId === focusSourceId)
              ?.focus({ preventScroll: true })
          }
        }}
        renderItem={(source) => (
          <div key={source.id} className="flex items-center gap-2 border-b px-3 hover:bg-muted/30 lg:gap-3 lg:px-4">
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
              className="flex h-auto min-h-28 min-w-0 flex-1 flex-col items-stretch gap-2 whitespace-normal px-2 py-4 text-left"
              onClick={() => onSelect(source.id)}
              data-source-id={source.id}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <PrivacySensitiveText className="min-w-0 max-w-full truncate font-medium">
                    {source.displayName}
                  </PrivacySensitiveText>
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
              <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="flex items-center gap-1 tabular-nums">
                  <span className="text-xs font-normal text-muted-foreground">待处理</span>
                  {source.catalogCounts ? (
                    source.catalogCounts.actionable
                  ) : (
                    <Skeleton className="h-4 w-8" aria-label="待处理数量加载中" />
                  )}
                </span>
                <span className="flex items-center gap-1 tabular-nums">
                  <span className="text-xs font-normal text-muted-foreground">异常</span>
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
                  {source.lastScanAt ? `最近扫描 ${formatArchiveUploaderTimestamp(source.lastScanAt)}` : '尚未扫描'}
                </span>
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
        )}
      />
    </section>
  )
}
