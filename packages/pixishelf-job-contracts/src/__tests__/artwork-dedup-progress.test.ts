import { describe, expect, it } from 'vitest'
import { artworkDedupRunDtoSchema } from '../artwork-dedup.ts'
import { artworkDedupProgressDataSchema, jobProgressDataSchema } from '../job-progress-data.ts'

const progress = {
  kind: 'artwork-dedup', version: 1, phase: 'VISUAL', completed: 2702, total: 5624,
  unit: 'images', waitReason: null, uncheckedMedia: 3, updatedAt: '2026-10-29T00:00:00.000Z'
} as const

describe('durable artwork detection progress', () => {
  it('uses the same aggregate snapshot in jobs and run DTOs', () => {
    expect(jobProgressDataSchema.parse(progress)).toEqual(progress)
    expect(artworkDedupRunDtoSchema.shape.progressData.parse(progress)).toEqual(progress)
    expect(artworkDedupRunDtoSchema.shape.progressData.parse(undefined)).toBeNull()
  })
  it('represents unknown and empty phases without a fabricated percentage', () => {
    expect(artworkDedupProgressDataSchema.parse({ ...progress, phase: 'PAIR', completed: null, total: null }).total).toBeNull()
    expect(artworkDedupProgressDataSchema.parse({ ...progress, completed: 0, total: 0 }).total).toBe(0)
  })
  it.each(['SCHEDULER', 'USER_PAUSED', 'VISUAL_COMPARISON_BUDGET', 'SOURCE_WRITE', 'RETRY'])('keeps %s distinct', waitReason => {
    expect(artworkDedupProgressDataSchema.parse({ ...progress, waitReason }).waitReason).toBe(waitReason)
  })
  it('rejects future versions, unsafe counters and private path fields at the boundary', () => {
    for (const patch of [{ version: 2 }, { completed: -1 }, { total: Number.MAX_SAFE_INTEGER + 1 }, { mediaPath: '/private/original.png' }]) {
      expect(artworkDedupProgressDataSchema.safeParse({ ...progress, ...patch }).success).toBe(false)
    }
  })
})
