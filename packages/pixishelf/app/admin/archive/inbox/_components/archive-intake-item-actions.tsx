import Link from 'next/link'
import type { Dispatch, SetStateAction } from 'react'
import { ExternalLinkIcon, PencilLineIcon, RotateCcwIcon } from 'lucide-react'
import {
  archiveIntakeItemHref,
  archiveTaskHref,
  isRetryableIntakeItem,
  type ArchiveIntakeSelectionItem,
  type ArchiveIntakeSelectionState,
  type ArchiveQuality
} from '@/app/admin/archive/_components/archive-intake-view-state'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

interface ArchiveIntakeActionItem extends ArchiveIntakeSelectionItem {
  queueOrder: string
  activeArchiveImportId: string | null
  archiveImportId: string | null
  duplicateOfItemId: string | null
}

interface ArchiveIntakeRetryActionsProps {
  item: ArchiveIntakeSelectionItem
  actionPending: boolean
  retrying: boolean
  onRetry: (itemId: string) => void
  onReplace: (itemId: string) => void
}

export function ArchiveIntakeItemActions({
  item,
  selection,
  onSelectionChange,
  actionPending,
  retrying,
  onRetry,
  onReplace
}: ArchiveIntakeRetryActionsProps & {
  item: ArchiveIntakeActionItem
  selection: ArchiveIntakeSelectionState
  onSelectionChange: Dispatch<SetStateAction<ArchiveIntakeSelectionState>>
}) {
  const canEnqueue = item.status === 'READY' && ['NEW', 'UPDATE', 'UNCHANGED'].includes(item.resolutionKind ?? '')
  const relatedTaskId = item.activeArchiveImportId || item.archiveImportId

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ArchiveIntakeRetryActions
        item={item}
        actionPending={actionPending}
        retrying={retrying}
        onRetry={onRetry}
        onReplace={onReplace}
      />
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

export function ArchiveIntakeRetryActions({
  item,
  actionPending,
  retrying,
  onRetry,
  onReplace
}: ArchiveIntakeRetryActionsProps) {
  return (
    <>
      {isRetryableIntakeItem(item) ? (
        <Button
          type="button"
          size="sm"
          aria-label={retrying ? '正在直接重试' : undefined}
          disabled={actionPending}
          onClick={() => onRetry(item.id)}
        >
          {retrying ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
          )}
          直接重试
        </Button>
      ) : null}
      {item.status === 'FAILED' ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={actionPending}
          onClick={() => onReplace(item.id)}
        >
          <PencilLineIcon data-icon="inline-start" aria-hidden="true" />
          修改并重试
        </Button>
      ) : null}
    </>
  )
}
