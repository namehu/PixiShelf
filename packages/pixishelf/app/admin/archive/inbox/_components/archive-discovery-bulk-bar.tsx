'use client'

import type { ReactNode } from 'react'
import { BanIcon, ClockIcon, CheckIcon, RotateCcwIcon, UnlinkIcon, UserRoundPlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

export function ArchiveDiscoveryBulkBar({
  deleteAction,
  reviewActions,
  selectedCount,
  kind,
  pending,
  ignoreDisabled = false,
  addLabel = '加入收件箱',
  onClear,
  onIgnore,
  onDefer,
  onAdd,
  onRestore,
  onBind,
  onCancelPending,
  addCount = selectedCount
}: {
  reviewActions?: ReactNode
  deleteAction?: ReactNode
  selectedCount: number
  kind: 'catalog' | 'ignored'
  pending: boolean
  ignoreDisabled?: boolean
  addLabel?: string
  onClear: () => void
  onIgnore?: () => void
  onDefer?: () => void
  onAdd?: () => void
  onRestore?: () => void
  onBind?: () => void
  onCancelPending?: () => void
  addCount?: number
}) {
  if (selectedCount === 0) return null

  return (
    <div
      className="sticky bottom-[calc(var(--app-mobile-navigation-offset)+0.75rem)] z-20 flex items-center justify-between gap-1 rounded-lg bg-background p-2 shadow-lg ring-1 ring-border sm:gap-3 sm:p-3 lg:bottom-4"
      role="region"
      aria-label="发现结果批量操作"
    >
      <div className="flex shrink-0 items-center gap-1 whitespace-nowrap text-sm font-medium sm:gap-2">
        <span className="tabular-nums">
          <span className="hidden sm:inline">已选择 </span>
          {selectedCount} 项
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-11 shrink-0 p-0 sm:h-9 sm:w-auto sm:px-3"
          aria-label="清除选择"
          title="清除选择"
          onClick={onClear}
          disabled={pending}
        >
          <XIcon data-icon="inline-start" aria-hidden="true" />
          <span className="hidden sm:inline">清除</span>
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto sm:gap-2 [&_button]:shrink-0">
        {kind === 'ignored' ? (
          <Button
            type="button"
            className="size-11 p-0 sm:h-9 sm:w-auto sm:px-4"
            aria-label="恢复"
            title="恢复"
            onClick={onRestore}
            disabled={pending}
          >
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">恢复</span>
          </Button>
        ) : (
          <>
            {onDefer ? (
              <Button variant="outline" disabled={pending} onClick={onDefer} aria-label="稍后决定" title="稍后决定">
                <ClockIcon data-icon="inline-start" aria-hidden="true" />
                <span className="hidden sm:inline">稍后决定</span>
              </Button>
            ) : null}
            {reviewActions}
            {deleteAction}
            {onBind ? (
              <Button
                type="button"
                variant="outline"
                className="size-11 p-0 sm:h-9 sm:w-auto sm:px-4"
                aria-label="绑定艺术家"
                title="绑定艺术家"
                onClick={onBind}
                disabled={pending}
              >
                <UserRoundPlusIcon aria-hidden="true" />
                <span className="hidden sm:inline">绑定艺术家</span>
              </Button>
            ) : null}
            {onCancelPending ? (
              <Button
                type="button"
                variant="outline"
                className="size-11 p-0 sm:h-9 sm:w-auto sm:px-4"
                aria-label="取消待生效绑定"
                title="取消待生效绑定"
                onClick={onCancelPending}
                disabled={pending}
              >
                <UnlinkIcon aria-hidden="true" />
                <span className="hidden sm:inline">取消待生效绑定</span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="size-11 p-0 sm:h-9 sm:w-auto sm:px-4"
              aria-label="忽略"
              title="忽略"
              onClick={onIgnore}
              disabled={pending || ignoreDisabled}
            >
              {pending ? <Spinner data-icon="inline-start" /> : <BanIcon data-icon="inline-start" aria-hidden="true" />}
              <span className="hidden sm:inline">忽略</span>
            </Button>
            <Button
              type="button"
              className="size-11 p-0 sm:h-9 sm:w-auto sm:px-4"
              aria-label={addLabel}
              title={addLabel}
              onClick={onAdd}
              disabled={pending || addCount === 0}
            >
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CheckIcon data-icon="inline-start" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{addLabel}</span>
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
