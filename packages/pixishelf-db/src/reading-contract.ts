/** Browser-safe reading contracts. Keep this module free of database imports. */
export const READING_REPORT_INTERVAL_MS = 3_000
export const READING_REPORT_MAX_AGE_MS = 60_000
export const READING_HEARTBEAT_INTERVAL_MS = 60_000
export const READING_VISIT_GAP_MS = 30 * 60_000
export const VIDEO_READING_COMPLETION_RATIO = 0.9
export const READING_LAYOUT_VERSION_CONFLICT_CODE = 'READING_LAYOUT_VERSION_CONFLICT'

/** A transient player observation, never a persisted resume position. */
export interface ReadingPlayback {
  currentTime: number
  duration: number
}
export function isVideoReadingComplete(playback: ReadingPlayback): boolean {
  return (
    Number.isFinite(playback.duration) &&
    playback.duration > 0 &&
    Number.isFinite(playback.currentTime) &&
    playback.currentTime >= playback.duration * VIDEO_READING_COMPLETION_RATIO
  )
}
export type ReadingStatus = 'UNREAD' | 'IN_PROGRESS' | 'COMPLETED'
export function getReadingStatus(summary: {
  completed: boolean
  progressCount: number
  viewCount: number
}): ReadingStatus {
  if (summary.completed) return 'COMPLETED'
  return summary.progressCount > 0 || summary.viewCount > 0 ? 'IN_PROGRESS' : 'UNREAD'
}
export interface ReadingMediaItem {
  isVideo?: boolean
  /** The current representative Image.id for one logical display item. */
  mediaId: number
  memberMediaIds: number[]
  /** Zero-based position in the complete logical media sequence. */
  index: number
}
export interface ReadingSummaryDto {
  artworkId: number
  readingLayoutVersion: number
  stateVersion: number
  viewCount: number
  progressCount: number
  totalCount: number
  completed: boolean
  furthestMediaId: number | null
  furthestMediaIndex: number | null
  status: ReadingStatus
  lastViewedAt: string | null
  lastActiveAt: string | null
  lastMediaId: number | null
  lastMediaIndex: number | null
}
export interface ReadingResumePosition {
  mediaId: number
  index: number
}
export interface ReadingContextDto {
  artworkId: number
  readingLayoutVersion: number
  media: ReadingMediaItem[]
  summary: ReadingSummaryDto
  resume: ReadingResumePosition | null
}
export type ReadingReportEvent =
  | {
      type: 'VIEW'
      mediaId: number
      index: number
      advanceTo?: ReadingResumePosition
      playback?: ReadingPlayback
      observedAt: string
    }
  | { type: 'HEARTBEAT'; mediaId: number; index: number; playback?: ReadingPlayback; observedAt: string }
export interface ReadingReportInput {
  artworkId: number
  expectedUserId: string
  readingLayoutVersion: number
  events: ReadingReportEvent[]
}
export interface ReadingMarkReadInput {
  artworkId: number
  expectedUserId: string
  readingLayoutVersion: number
}
export interface ReadingReportResult {
  readingLayoutVersion: number
  summary: ReadingSummaryDto
}
export interface ReadingBatchSummariesResult {
  summaries: ReadingSummaryDto[]
}
export interface ReadingHistoryCursor {
  lastViewedAt: string
  artworkId: number
}
export function compareReadingVersion(a: ReadingSummaryDto, b: ReadingSummaryDto): number {
  return a.readingLayoutVersion - b.readingLayoutVersion || a.stateVersion - b.stateVersion
}
