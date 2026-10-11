import type { ScanRun, SystemJob } from '@prisma/client'

/** External status consumers use nullable job messages and statistics at data; keep this DTO separate from ApiResponse. */
export type LegacyScanWebhookStatusResponse = Pick<SystemJob, 'status' | 'progress' | 'message' | 'error'> & {
  success: true
  jobId: string
  scanRunId: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  data: Pick<
    ScanRun,
    | 'totalArtworks'
    | 'processedArtworks'
    | 'succeededArtworks'
    | 'skippedArtworks'
    | 'failedArtworks'
    | 'newImages'
    | 'durationMs'
    | 'walkedEntries'
    | 'metadataCandidates'
    | 'inventoryUnchanged'
    | 'contentHashed'
    | 'contentChanged'
    | 'parsedInputs'
    | 'publishedInputs'
    | 'failedInputs'
    | 'discoveryDurationMs'
    | 'hashDurationMs'
    | 'publishDurationMs'
  >
}
