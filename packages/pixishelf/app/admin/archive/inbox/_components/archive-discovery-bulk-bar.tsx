'use client'

import { BanIcon, CheckIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

export function ArchiveDiscoveryBulkBar({
  selectedCount,
  kind,
  pending,
  ignoreDisabled = false,
  addLabel = '加入收件箱',
  onClear,
  onIgnore,
  onAdd,
  onRestore
}: {
  selectedCount: number
  kind: 'catalog' | 'ignored'
  pending: boolean
  ignoreDisabled?: boolean
  addLabel?: string
  onClear: () => void
  onIgnore?: () => void
  onAdd?: () => void
  onRestore?: () => void
}) {
  if (selectedCount === 0) return null

  return (
    <div
      className="sticky bottom-[calc(var(--app-mobile-navigation-offset)+0.75rem)] z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:bottom-4"
      role="region"
      aria-label="发现结果批量操作"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        已选择 {selectedCount} 项
        <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={pending}>
          <XIcon data-icon="inline-start" aria-hidden="true" />
          清除
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {kind === 'ignored' ? (
          <Button type="button" onClick={onRestore} disabled={pending}>
            {pending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
            )}
            恢复（{selectedCount}）
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onIgnore} disabled={pending || ignoreDisabled}>
              {pending ? <Spinner data-icon="inline-start" /> : <BanIcon data-icon="inline-start" aria-hidden="true" />}
              忽略（{selectedCount}）
            </Button>
            <Button type="button" onClick={onAdd} disabled={pending}>
              {pending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CheckIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {addLabel}（{selectedCount}）
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
