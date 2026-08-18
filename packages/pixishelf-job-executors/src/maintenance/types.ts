import type { Prisma, PrismaClient } from '@pixishelf/db'

export type MaintenanceDatabase = Pick<
  PrismaClient,
  | 'archiveBulkOperation'
  | 'archiveIntakeItem'
  | 'archiveIntakeSubmission'
  | 'archivePreviewSession'
  | 'artwork'
  | 'artworkTag'
  | 'image'
  | 'scanRun'
  | 'tag'
  | 'triggerLog'
>

export type MaintenanceTransaction = Prisma.TransactionClient

export type RunMaintenanceMutation = <T>(operation: (transaction: MaintenanceTransaction) => Promise<T>) => Promise<T>

export interface MaintenanceProgress {
  percentage: number
  stage: string
  message: string
  data?: Record<string, unknown>
}

export interface MaintenanceOperationInput {
  database: MaintenanceDatabase
  mutate: RunMaintenanceMutation
  signal: AbortSignal
  progress(update: MaintenanceProgress): Promise<void>
}

export function throwIfMaintenanceAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Maintenance execution was interrupted')
}
