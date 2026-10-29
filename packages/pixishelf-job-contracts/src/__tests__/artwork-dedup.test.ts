import { describe, expect, it } from 'vitest'
import {
  ARTWORK_DEDUP_DEFAULTS,
  ARTWORK_DEDUP_PRIORITY,
  ARTWORK_DEDUP_SCAN_DEFINITION_VERSION,
  artworkDedupGetRunInputSchema,
  artworkDedupRunDtoSchema,
  artworkDedupScanPayloadSchema,
  artworkDedupStartInputSchema
} from '../artwork-dedup.ts'
import { executionLaneForJobType } from '../job-types.ts'
import { parseJobPayload } from '../payloads.ts'
describe('artwork detection contract', () => {
  it('fixes the bounded resource defaults and strict payload', () => {
    expect(ARTWORK_DEDUP_DEFAULTS).toEqual({
      mediaPageSize: 500,
      statConcurrency: 4,
      hashConcurrency: 1,
      cacheBatchSize: 100,
      yieldAfterMs: 10000,
      yieldAfterBytes: 268435456,
      cooldownMs: 3000,
      stallTimeoutMs: 30000
    })
    expect(ARTWORK_DEDUP_PRIORITY).toBe(900)
    expect(ARTWORK_DEDUP_SCAN_DEFINITION_VERSION).toBe(8)
    expect(executionLaneForJobType('ARTWORK_DEDUP_SCAN')).toBe('BACKGROUND_WRITER')
    expect(parseJobPayload('ARTWORK_DEDUP_SCAN', { runId: 'run', executionVersion: 1 })).toEqual({
      runId: 'run',
      executionVersion: 1
    })
    for (const value of [
      { runId: 'run', executionVersion: 0 },
      { runId: 'run', executionVersion: 1, priority: 0 },
      { runId: 'run', executionVersion: 1, paths: ['private'] }
    ])
      {expect(artworkDedupScanPayloadSchema.safeParse(value).success).toBe(false)}
  })
  it('allows exactly one persisted discovery identity and rejects spoofed ownership fields', () => {
    expect(artworkDedupGetRunInputSchema.safeParse({ artistId: 1, expectedUserId: 'u' }).success).toBe(true)
    expect(artworkDedupGetRunInputSchema.safeParse({ artistId: 1, runId: 'r', expectedUserId: 'u' }).success).toBe(
      false
    )
    expect(
      artworkDedupStartInputSchema.safeParse({
        artistId: 1,
        expectedUserId: 'u',
        idempotencyKey: 'k',
        requestedBy: 'other'
      }).success
    ).toBe(false)
  })
  it('defaults legacy pause reasons without exposing mutable budget inputs', () => {
    const pauseReason = artworkDedupRunDtoSchema.shape.pauseReason
    expect(pauseReason.parse(undefined)).toBeNull()
    expect(pauseReason.parse('VISUAL_COMPARISON_BUDGET')).toBe('VISUAL_COMPARISON_BUDGET')
    expect(pauseReason.safeParse('VISUAL_EDGE_BUDGET').success).toBe(false)
  })

})
