import { describe, expect, it } from 'vitest'
import { buildArtworkStacks } from '../artwork-stacks'
import { ReadingReportInputSchema } from '@/schemas/reading.dto'
import type { MediaIndexItem } from '@/schemas/artwork-reader.dto'

const items = (count: number): MediaIndexItem[] => Array.from({ length: count }, (_, index) => ({
  mediaId: index + 1, memberMediaIds: [index + 1], index, mediaType: 'image', isAnimated: false,
  width: 800, height: 1200, reliableDimensions: true
}))
describe('deterministic artwork stacks', () => {
  it.each([[100, 25], [300, 75], [1000, 125]])('reduces %i static images to %i covers', (total, expected) => {
    expect(buildArtworkStacks(items(total))).toHaveLength(expected!)
  })
  it.each([0, 1, 2, 3, 4, 5, 9, 319, 320, 321, 640, 641, 1001])('preserves every media exactly once and bounds groups at %i items', (total) => {
    const media = items(total)
    const groups = buildArtworkStacks(media)
    expect(groups.flatMap((group) => group.mediaIds)).toEqual(media.map((item) => item.mediaId))
    expect(new Set(groups.map((group) => group.id)).size).toBe(groups.length)
    expect(groups.every((group) => group.mediaIds.length > 0 && group.mediaIds.length <= 8 && group.representativeMediaId === group.mediaIds[0])).toBe(true)
    expect(buildArtworkStacks(media)).toEqual(groups)
  })
  it('balances a short last group and never crosses animated, video or logical-pair boundaries', () => {
    const media = items(15)
    media[4]!.isAnimated = true
    media[9]!.mediaType = 'video'
    media[10]!.memberMediaIds = [11, 999]
    expect(buildArtworkStacks(media).map((group) => group.mediaIds)).toEqual([[1, 2, 3, 4], [5], [6, 7, 8, 9], [10], [11], [12, 13, 14, 15]])
    expect(buildArtworkStacks(items(9)).map((group) => group.mediaIds.length)).toEqual([3, 3, 3])
  })
  it('accepts versioned stack evidence but rejects ambiguous or client-supplied membership', () => {
    const stack = { ruleVersion: 1, fingerprint: 'a'.repeat(64), groupId: 'stack-v1-1-4' }
    const input = (extra: object) => ({ artworkId: 1, expectedUserId: 'a', mediaRevision: 1,
      events: [{ type: 'VIEW', mediaId: 1, observedAt: new Date().toISOString(), ...extra }] })
    expect(ReadingReportInputSchema.safeParse(input({ stack })).success).toBe(true)
    expect(ReadingReportInputSchema.safeParse(input({ stack: { ...stack, mediaIds: [99] } })).success).toBe(false)
    expect(ReadingReportInputSchema.safeParse(input({ stack, summary: { generationId: '4c328fb2-aada-4027-a1df-cbecc87367b3', groupId: '1' } })).success).toBe(false)
  })
})
