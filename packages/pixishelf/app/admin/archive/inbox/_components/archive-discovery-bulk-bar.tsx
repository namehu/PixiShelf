'use client'

import type { ReactNode } from 'react'
import {
  BanIcon,
  ClockIcon,
  CheckIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  InboxIcon,
  RotateCcwIcon,
  UnlinkIcon,
  UserRoundPlusIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

export function ArchiveDiscoverySelectionBar({
  selectedCount,
  pending,
  onClear,
  primaryAction,
  secondaryAction,
  menuItems,
  options,
  label = '发现结果批量操作'
}: {
  selectedCount: number
  pending: boolean
  onClear: () => void
  primaryAction: ReactNode
  secondaryAction?: ReactNode
  menuItems?: ReactNode
  options?: ReactNode
  label?: string
}) {
  if (selectedCount === 0) return null

  return (
    <div
      className="sticky bottom-[calc(var(--app-mobile-navigation-offset)+0.75rem)] z-20 mt-3 grid grid-cols-2 items-center gap-2 rounded-lg bg-background p-3 shadow-lg sm:flex sm:flex-wrap sm:gap-3 lg:bottom-4"
      role="region"
      aria-label={label}
      aria-busy={pending}
    >
      <div className={cn('flex min-w-0 items-center gap-2 sm:mr-auto', !options && 'col-span-2')}>
        <span className="min-w-0 text-sm font-medium tabular-nums">已选择 {selectedCount} 项</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 min-w-11 shrink-0 px-2 sm:min-h-9"
          aria-label="清除选择"
          onClick={onClear}
          disabled={pending}
        >
          清除
        </Button>
      </div>
      {options ? <div className="flex min-w-0 justify-end sm:ml-auto">{options}</div> : null}
      <div
        className={cn(
          'col-span-2 grid min-w-0 items-start gap-2 sm:flex sm:items-center [&_button]:h-auto [&_button]:min-h-11 [&_button]:min-w-0 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:px-2 [&_button]:py-2 [&_button]:sm:min-h-9 [&_button]:sm:px-3',
          menuItems && secondaryAction ? 'grid-cols-3' : menuItems || secondaryAction ? 'grid-cols-2' : 'grid-cols-1'
        )}
      >
        {menuItems ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" disabled={pending}>
                <EllipsisIcon data-icon="inline-start" aria-hidden="true" className="hidden sm:block" />
                更多操作
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="min-w-52 [&_[role=menuitem]]:min-h-11">
              {menuItems}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {secondaryAction ? <div className="min-w-0 [&_button]:w-full">{secondaryAction}</div> : null}
        <div className="min-w-0 [&_button]:w-full">{primaryAction}</div>
      </div>
    </div>
  )
}

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
  onViewEvidence,
  onOpenInbox,
  onRearchive,
  options,
  addCount = selectedCount,
  ignoreCount = selectedCount,
  deferCount = selectedCount
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
  onViewEvidence?: () => void
  onOpenInbox?: () => void
  onRearchive?: () => void
  options?: ReactNode
  addCount?: number
  ignoreCount?: number
  deferCount?: number
}) {
  const hasMenu =
    kind === 'catalog' &&
    Boolean(
      onIgnore ||
        onBind ||
        onCancelPending ||
        onViewEvidence ||
        onOpenInbox ||
        onRearchive ||
        reviewActions ||
        deleteAction
    )

  return (
    <ArchiveDiscoverySelectionBar
      selectedCount={selectedCount}
      pending={pending}
      onClear={onClear}
      options={kind === 'catalog' ? options : undefined}
      primaryAction={
        kind === 'ignored' ? (
          <Button type="button" aria-label="恢复" onClick={onRestore} disabled={pending}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RotateCcwIcon data-icon="inline-start" aria-hidden="true" className="hidden sm:block" />
            )}
            <span className="min-w-0">恢复（{selectedCount}）</span>
          </Button>
        ) : (
          <>
            <Button type="button" aria-label={addLabel} onClick={onAdd} disabled={pending || addCount === 0}>
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CheckIcon data-icon="inline-start" aria-hidden="true" className="hidden sm:block" />
              )}
              <span className="min-w-0">
                {addLabel}（{addCount}）
              </span>
            </Button>
            {addCount === 0 ? <p className="mt-1 text-xs text-muted-foreground">所选项目暂无可加入项</p> : null}
          </>
        )
      }
      secondaryAction={
        kind === 'catalog' && onDefer ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending || deferCount === 0}
            onClick={onDefer}
            aria-label="稍后决定"
          >
            <ClockIcon data-icon="inline-start" aria-hidden="true" className="hidden sm:block" />
            <span className="min-w-0">稍后决定（{deferCount}）</span>
          </Button>
        ) : undefined
      }
      menuItems={
        hasMenu ? (
          <>
            <DropdownMenuGroup>
              {onViewEvidence ? (
                <DropdownMenuItem disabled={pending} onSelect={onViewEvidence}>
                  <ExternalLinkIcon aria-hidden="true" />
                  查看匹配依据
                </DropdownMenuItem>
              ) : null}
              {onOpenInbox ? (
                <DropdownMenuItem disabled={pending} onSelect={onOpenInbox}>
                  <InboxIcon aria-hidden="true" />
                  去收件箱处理
                </DropdownMenuItem>
              ) : null}
              {onRearchive ? (
                <DropdownMenuItem disabled={pending} onSelect={onRearchive}>
                  <RotateCcwIcon aria-hidden="true" />
                  重新归档
                </DropdownMenuItem>
              ) : null}
              {onIgnore ? (
                <DropdownMenuItem
                  aria-label="忽略"
                  disabled={pending || ignoreDisabled || ignoreCount === 0}
                  onSelect={onIgnore}
                >
                  <BanIcon aria-hidden="true" />
                  忽略（{ignoreCount}）
                </DropdownMenuItem>
              ) : null}
              {onBind ? (
                <DropdownMenuItem disabled={pending} onSelect={onBind}>
                  <UserRoundPlusIcon aria-hidden="true" />
                  绑定艺术家（{selectedCount}）
                </DropdownMenuItem>
              ) : null}
              {onCancelPending ? (
                <DropdownMenuItem disabled={pending} onSelect={onCancelPending}>
                  <UnlinkIcon aria-hidden="true" />
                  取消待生效绑定
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
            {reviewActions ? (
              <>
                <DropdownMenuSeparator />
                {reviewActions}
              </>
            ) : null}
            {deleteAction ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>{deleteAction}</DropdownMenuGroup>
              </>
            ) : null}
          </>
        ) : undefined
      }
    />
  )
}
