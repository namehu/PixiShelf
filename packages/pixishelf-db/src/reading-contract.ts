/** Browser-safe reading contracts. Keep this module free of database imports. */

export const READING_MANUAL_VISIBLE_MS = 500
export const READING_REPORT_INTERVAL_MS = 5_000
export const READING_REPORT_MAX_AGE_MS = 60_000
export const READING_HEARTBEAT_INTERVAL_MS = 60_000
export const READING_VISIT_GAP_MS = 30 * 60_000
export const READING_MEDIA_REVISION_CONFLICT_CODE = 'READING_MEDIA_REVISION_CONFLICT'

export type ReadingStatus = 'UNREAD' | 'IN_PROGRESS' | 'COMPLETED'

export interface ReadingMediaItem {
  /** The current representative Image.id for one logical display item. */
  mediaId: number
  /** All current Image.id values belonging to this logical display item. */
  memberMediaIds: number[]
  /** Zero-based position in the complete logical media sequence. */
  index: number
}

export interface ReadingSummaryDto {
  artworkId: number
  viewCount: number
  seenCount: number
  totalCount: number
  status: ReadingStatus
  /** ISO 8601 UTC timestamp of the last accepted visible media observation. */
  lastViewedAt: string | null
  /** ISO 8601 UTC timestamp of the last accepted observation or valid heartbeat. */
  lastActiveAt: string | null
  /** Observed Image.id, which may have been a group member rather than its representative. */
  lastMediaId: number | null
  /** Position when the observation was accepted; current position is resolved via member IDs. */
  lastMediaIndex: number | null
}

export interface ReadingResumePosition {
  mediaId: number
  index: number
}

export interface ReadingContextDto {
  artworkId: number
  mediaRevision: number
  media: ReadingMediaItem[]
  summary: ReadingSummaryDto
  resume: ReadingResumePosition | null
}

export type ReadingReportEvent =
  | {
      type: 'VIEW'
      mediaId: number
      /** ISO 8601 UTC timestamp when the effective observation began. */
      observedAt: string
    }
  | {
      type: 'HEARTBEAT'
      mediaId: number
      /** ISO 8601 UTC timestamp while the same media remained effectively visible. */
      observedAt: string
    }

export interface ReadingReportInput {
  artworkId: number
  mediaRevision: number
  /** Session consistency precondition only; the server always derives ownership from auth. */
  expectedUserId: string
  events: ReadingReportEvent[]
}

export interface ReadingReportResult {
  mediaRevision: number
  summary: ReadingSummaryDto
}

export interface ReadingBatchSummariesResult {
  summaries: ReadingSummaryDto[]
}

export interface ReadingHistoryCursor {
  lastViewedAt: string
  artworkId: number
}
