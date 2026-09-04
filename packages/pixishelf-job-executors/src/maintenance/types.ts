import type { JobEventLevel, JobProgressData } from '@pixishelf/job-contracts'
import type { Prisma, PrismaClient } from '@pixishelf/db'

export type MaintenanceDatabase = Pick<
  PrismaClient,
  | 'archiveBulkOperation'
  | 'archiveIntakeItem'
  | 'archiveIntakeSubmission'
  | 'archivePreviewSession'
  | 'archiveUploaderScanRun'
  | 'artwork'
  | 'artworkTag'
  | 'image'
  | 'scanRun'
  | 'tag'
  | 'triggerLog'
  | 'systemJobEvent'
>

export type MaintenanceTransaction = Prisma.TransactionClient

export type RunMaintenanceMutation = <T>(operation: (transaction: MaintenanceTransaction) => Promise<T>) => Promise<T>

export interface MaintenanceProgress {
  percentage: number
  stage: string
  message: string
  data?: Record<string, unknown>
  progressData?: JobProgressData
  persistenceMode?: 'STANDARD' | 'REALTIME'
  forcePersistence?: boolean
  level?: JobEventLevel
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
