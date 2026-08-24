import type { ComponentProps, ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'

type AdminStatusTone = 'default' | 'info' | 'success' | 'warning' | 'destructive' | 'muted'

const statusToneMap: Record<string, AdminStatusTone> = {
  ACTIVE: 'success',
  COMPLETED: 'success',
  DONE: 'success',
  READY: 'success',
  RESTORED: 'success',
  BACKUP_CLEANED: 'success',
  SUCCESS: 'success',
  RUNNING: 'info',
  PROCESSING: 'info',
  STAGING: 'info',
  BACKING_UP: 'info',
  SWAPPING: 'info',
  COMMITTING: 'info',
  ROLLING_BACK: 'info',
  RESTORING: 'info',
  RESTORE_SWAPPING: 'info',
  UPLOADING: 'info',
  PENDING: 'warning',
  PAUSING: 'warning',
  PAUSED: 'warning',
  RETRY_WAIT: 'warning',
  CANCELLING: 'warning',
  WAITING: 'warning',
  PARTIAL_ERROR: 'warning',
  FAILED: 'destructive',
  ERROR: 'destructive',
  INVALID: 'destructive',
  CANCELLED: 'muted',
  IDLE: 'muted',
  SKIPPED: 'muted',
  EXCLUDED: 'muted'
}

export function getAdminStatusTone(status: string): AdminStatusTone {
  return statusToneMap[status.trim().replaceAll('-', '_').toUpperCase()] ?? 'default'
}

export function AdminStatusBadge({
  status,
  children,
  ...props
}: Omit<ComponentProps<typeof Badge>, 'variant'> & {
  status: string
  children?: ReactNode
}) {
  return (
    <Badge variant={getAdminStatusTone(status)} data-status={status} {...props}>
      {children ?? status}
    </Badge>
  )
}

export type { AdminStatusTone }
