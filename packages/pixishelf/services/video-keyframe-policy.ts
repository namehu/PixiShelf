export const VIDEO_KEYFRAME_POLICY_VERSION = 1
export const VIDEO_KEYFRAME_QUEUE_LOCK_ID = 7_283_450
export const VIDEO_KEYFRAME_CANDIDATE_MULTIPLIER = 3
export const VIDEO_KEYFRAME_MAX_PUBLISHED_COUNT = 30

export interface VideoKeyframeFilter {
  minDuration: number | null
  maxDuration: number | null
  includePaths: string[]
  excludePaths: string[]
  statuses: VideoKeyframeDiscoveryStatus[]
}

export type VideoKeyframeDiscoveryStatus = 'MISSING' | 'STALE' | 'FAILED'

export interface VideoKeyframeCandidateMetrics {
  candidateIndex: number
  captureTime: number
  path: string
  luma: number
  sharpness: number
  perceptualHash: string
}

export function getVideoKeyframeTargetCount(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  if (durationSeconds <= 10 * 60) return 6
  if (durationSeconds <= 60 * 60) return 12
  if (durationSeconds <= 3 * 60 * 60) return 20
  return VIDEO_KEYFRAME_MAX_PUBLISHED_COUNT
}

export function buildVideoKeyframeCandidateTimes(durationSeconds: number, targetCount: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || targetCount <= 0) return []

  const desiredCount = Math.min(
    VIDEO_KEYFRAME_MAX_PUBLISHED_COUNT * VIDEO_KEYFRAME_CANDIDATE_MULTIPLIER,
    targetCount * VIDEO_KEYFRAME_CANDIDATE_MULTIPLIER
  )
  const durationBoundCount = Math.max(targetCount, Math.floor(durationSeconds * 2))
  const candidateCount = Math.min(desiredCount, durationBoundCount)

  return Array.from({ length: candidateCount }, (_, index) => {
    const timestamp = (durationSeconds * (index + 1)) / (candidateCount + 1)
    return Number(timestamp.toFixed(3))
  })
}

export function normalizeVideoKeyframeFilter(value: unknown): VideoKeyframeFilter {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    minDuration: normalizeDuration(input.minDuration),
    maxDuration: normalizeDuration(input.maxDuration),
    includePaths: normalizePathPrefixes(input.includePaths),
    excludePaths: normalizePathPrefixes(input.excludePaths),
    statuses: normalizeStatuses(input.statuses)
  }
}

export function matchesVideoKeyframeFilter(
  input: { duration: number | null; path: string; status?: VideoKeyframeDiscoveryStatus },
  filter: VideoKeyframeFilter
): boolean {
  if (input.duration !== null) {
    if (filter.minDuration !== null && input.duration < filter.minDuration) return false
    if (filter.maxDuration !== null && input.duration > filter.maxDuration) return false
  } else if (filter.minDuration !== null || filter.maxDuration !== null) {
    return false
  }

  const normalizedPath = normalizeComparablePath(input.path)
  if (
    filter.includePaths.length > 0 &&
    !filter.includePaths.some((prefix) => normalizedPath.startsWith(normalizeComparablePath(prefix)))
  ) {
    return false
  }
  if (filter.excludePaths.some((prefix) => normalizedPath.startsWith(normalizeComparablePath(prefix)))) return false
  return !input.status || filter.statuses.includes(input.status)
}

export function selectRepresentativeKeyframes(
  candidates: VideoKeyframeCandidateMetrics[],
  targetCount: number
): VideoKeyframeCandidateMetrics[] {
  if (targetCount <= 0 || candidates.length === 0) return []

  const valid = candidates
    .filter((candidate) => candidate.luma >= 8 && candidate.luma <= 247 && candidate.sharpness >= 4)
    .sort((a, b) => a.captureTime - b.captureTime)
  const buckets = Array.from({ length: targetCount }, () => [] as VideoKeyframeCandidateMetrics[])
  for (let index = 0; index < valid.length; index += 1) {
    const bucketIndex = Math.min(targetCount - 1, Math.floor((index / valid.length) * targetCount))
    buckets[bucketIndex]!.push(valid[index]!)
  }

  const selected: VideoKeyframeCandidateMetrics[] = []
  for (const bucket of buckets) {
    const ranked = [...bucket].sort((a, b) => qualityScore(b) - qualityScore(a))
    const distinct = ranked.find((candidate) =>
      selected.every((current) => hammingDistanceHex(candidate.perceptualHash, current.perceptualHash) > 6)
    )
    if (distinct) selected.push(distinct)
  }

  while (selected.length < targetCount) {
    const remaining = valid
      .filter((candidate) => !selected.some((current) => current.candidateIndex === candidate.candidateIndex))
      .filter((candidate) =>
        selected.every((current) => hammingDistanceHex(candidate.perceptualHash, current.perceptualHash) > 6)
      )
      .sort((left, right) => {
        const coverageDifference = minimumTemporalDistance(right, selected) - minimumTemporalDistance(left, selected)
        return coverageDifference || qualityScore(right) - qualityScore(left) || left.captureTime - right.captureTime
      })
    const next = remaining[0]
    if (!next) break
    selected.push(next)
  }

  return selected.sort((a, b) => a.captureTime - b.captureTime)
}

export function hammingDistanceHex(left: string, right: string): number {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY
  let distance = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftNibble = Number.parseInt(left[index]!, 16)
    const rightNibble = Number.parseInt(right[index]!, 16)
    if (!Number.isFinite(leftNibble) || !Number.isFinite(rightNibble)) return Number.POSITIVE_INFINITY
    let value = leftNibble ^ rightNibble
    while (value > 0) {
      distance += value & 1
      value >>= 1
    }
  }
  return distance
}

function qualityScore(candidate: VideoKeyframeCandidateMetrics): number {
  return candidate.sharpness - Math.abs(candidate.luma - 128) * 0.05
}

function minimumTemporalDistance(candidate: VideoKeyframeCandidateMetrics, selected: VideoKeyframeCandidateMetrics[]) {
  if (selected.length === 0) return Number.POSITIVE_INFINITY
  return Math.min(...selected.map((current) => Math.abs(candidate.captureTime - current.captureTime)))
}

function normalizeDuration(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizePathPrefixes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : [])))]
}

function normalizeStatuses(value: unknown): VideoKeyframeDiscoveryStatus[] {
  const supported: VideoKeyframeDiscoveryStatus[] = ['MISSING', 'STALE', 'FAILED']
  if (!Array.isArray(value)) return supported
  const normalized = supported.filter((status) => value.includes(status))
  return normalized.length > 0 ? normalized : supported
}

function normalizeComparablePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
  return normalized ? `${normalized.replace(/\/+$/, '')}/`.replace(/\/\/$/, '/') : ''
}
