import { Badge } from '@/components/ui/badge'
import { archiveIntakeStatusLabel, type ArchiveIntakeSelectionItem } from '../../_components/archive-intake-view-state'

export function ArchiveIntakeStatusBadge({ item }: { item: ArchiveIntakeSelectionItem }) {
  const { status } = item
  const variant =
    status === 'FAILED'
      ? 'destructive'
      : status === 'STALE' || status === 'RETRY_WAIT' || status === 'READY'
        ? 'warning'
        : status === 'RESOLVING'
          ? 'info'
          : status === 'ENQUEUED'
            ? 'success'
            : 'muted'
  return <Badge variant={variant}>{archiveIntakeStatusLabel(item)}</Badge>
}

export function ArchiveIntakeResolutionBadge({ kind }: { kind: string | null }) {
  if (!kind) return <Badge variant="muted">待判断</Badge>
  const labels = {
    NEW: '新归档',
    UPDATE: '内容有变化',
    UNCHANGED: '未变化',
    ACTIVE_TASK: '已有活动任务',
    DUPLICATE_IDENTITY: '作品身份重复'
  } as const
  const variant =
    kind === 'NEW'
      ? 'success'
      : kind === 'UPDATE'
        ? 'info'
        : kind === 'ACTIVE_TASK' || kind === 'DUPLICATE_IDENTITY'
          ? 'warning'
          : 'muted'
  return <Badge variant={variant}>{labels[kind as keyof typeof labels] ?? kind}</Badge>
}
