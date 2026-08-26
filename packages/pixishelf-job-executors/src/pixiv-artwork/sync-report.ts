import { createHash } from 'node:crypto'

import {
  PIXIV_ARTWORK_SYNC_REPORT_TEXT_PREVIEW_LIMIT,
  PIXIV_ARTWORK_SYNC_REPORT_VERSION,
  type PixivArtworkSyncReport,
  type PixivArtworkSyncReportFieldKey,
  type PixivArtworkSyncReportValue
} from '@pixishelf/job-contracts'

export type PixivArtworkSyncComparableValue = string | number | boolean | Date | null
export type PixivArtworkSyncTrackedState = Record<
  PixivArtworkSyncReportFieldKey,
  PixivArtworkSyncComparableValue
>

const TRACKED_FIELDS: readonly PixivArtworkSyncReportFieldKey[] = [
  'title',
  'description',
  'titleOverridden',
  'descriptionOverridden',
  'bookmarkCount',
  'isAiGenerated',
  'originalUrl',
  'size',
  'sourceDate',
  'sourceUrl',
  'thumbnailUrl',
  'xRestrict',
  'pixivAiType',
  'pixivType',
  'sanityLevel'
]

export function buildPixivArtworkSyncReport(input: {
  jobId: string
  artworkId: number
  externalRefId: string
  pixivArtworkId: string
  checkedAt: Date
  refreshExisting: boolean
  status: 'SUCCESS' | 'PARTIAL'
  beforeState: PixivArtworkSyncTrackedState
  afterState: PixivArtworkSyncTrackedState
  beforeTags: string[]
  afterTags: string[]
  protectedFields: Array<'title' | 'description'>
  beforeSnapshot: { hash: string; path: string } | null
  afterSnapshot: { hash: string; path: string }
}): PixivArtworkSyncReport {
  const fields = TRACKED_FIELDS.flatMap((key) => {
    const before = normalizeComparableValue(input.beforeState[key])
    const after = normalizeComparableValue(input.afterState[key])
    return equalReportValues(before, after) ? [] : [{ key, before, after }]
  })
  const beforeTags = uniqueSorted(input.beforeTags)
  const afterTags = uniqueSorted(input.afterTags)
  const beforeTagSet = new Set(beforeTags)
  const afterTagSet = new Set(afterTags)
  const added = afterTags.filter((tag) => !beforeTagSet.has(tag))
  const removed = beforeTags.filter((tag) => !afterTagSet.has(tag))
  const snapshotChanged = input.beforeSnapshot?.hash !== input.afterSnapshot.hash
  const databaseChanged = fields.length > 0 || added.length > 0 || removed.length > 0
  const changeKind =
    input.status === 'PARTIAL'
      ? 'PARTIAL'
      : databaseChanged
        ? 'UPDATED'
        : snapshotChanged
          ? 'SNAPSHOT_ONLY'
          : 'UNCHANGED'

  return {
    schemaVersion: PIXIV_ARTWORK_SYNC_REPORT_VERSION,
    jobId: input.jobId,
    artworkId: input.artworkId,
    externalRefId: input.externalRefId,
    pixivArtworkId: input.pixivArtworkId,
    checkedAt: input.checkedAt.toISOString(),
    refreshExisting: input.refreshExisting,
    status: input.status,
    changeKind,
    fields,
    tags: { before: beforeTags, after: afterTags, added, removed },
    protectedFields: uniqueSorted(input.protectedFields) as Array<'title' | 'description'>,
    snapshots: {
      before: input.beforeSnapshot,
      after: input.afterSnapshot,
      changed: snapshotChanged
    }
  }
}

function normalizeComparableValue(value: PixivArtworkSyncComparableValue): PixivArtworkSyncReportValue {
  const normalized = value instanceof Date ? value.toISOString() : value
  if (typeof normalized !== 'string' || normalized.length <= PIXIV_ARTWORK_SYNC_REPORT_TEXT_PREVIEW_LIMIT) {
    return { value: normalized }
  }
  return {
    value: normalized.slice(0, PIXIV_ARTWORK_SYNC_REPORT_TEXT_PREVIEW_LIMIT),
    truncated: true,
    originalLength: normalized.length,
    sha256: createHash('sha256').update(normalized).digest('hex')
  }
}

function equalReportValues(left: PixivArtworkSyncReportValue, right: PixivArtworkSyncReportValue) {
  return (
    left.value === right.value &&
    left.truncated === right.truncated &&
    left.originalLength === right.originalLength &&
    left.sha256 === right.sha256
  )
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'und'))
}
