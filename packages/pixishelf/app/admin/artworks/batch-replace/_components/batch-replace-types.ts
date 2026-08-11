import type { PendingReplaceMediaSnapshot } from '@/schemas/pending-replace.dto'

export interface BatchItemView {
  id: string
  artworkId: number | null
  externalId: string | null
  artworkTitle: string | null
  artistName: string | null
  sourceDirectory: string
  sourceDirectoryName: string
  targetDirectory: string | null
  status: string
  included: boolean
  oldMediaSnapshot: PendingReplaceMediaSnapshot[]
  newMediaSnapshot: PendingReplaceMediaSnapshot[]
  warnings: string[]
  error: string | null
  backupDirectory: string | null
}

export interface BatchView {
  id: string
  status: string
  totalItems: number
  readyItems: number
  invalidItems: number
  excludedItems: number
  succeededItems: number
  failedItems: number
  restoredItems: number
  backupBytes: number
  createdAt: string | Date
  items: BatchItemView[]
  systemJob: {
    status: string
    progress: number
    message: string | null
    error: string | null
    heartbeatAt: string | Date | null
    updatedAt: string | Date
  } | null
}
