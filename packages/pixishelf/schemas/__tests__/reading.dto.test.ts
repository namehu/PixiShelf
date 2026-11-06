import { describe, expect, it } from 'vitest'
import { ReadingReportInputSchema, ReadingMarkReadInputSchema } from '../reading.dto'
const input = {
  artworkId: 1,
  expectedUserId: 'u',
  readingLayoutVersion: 1,
  events: [{ type: 'VIEW', mediaId: 2, index: 0, observedAt: '2026-11-04T12:00:00Z' }]
}
describe('position reading boundary', () => {
  it('accepts an indexed observation and static tail position', () => {
    expect(ReadingReportInputSchema.parse(input)).toEqual(input)
    expect(
      ReadingReportInputSchema.safeParse({
        ...input,
        events: [{ ...input.events[0], advanceTo: { mediaId: 4, index: 2 } }]
      }).success
    ).toBe(true)
  })
  it.each([
    { ...input, mediaRevision: 1 },
    { ...input, events: [{ ...input.events[0], index: undefined }] },
    { ...input, events: [{ ...input.events[0], index: -1 }] },
    { ...input, events: [{ ...input.events[0], summary: { generationId: 'x', groupId: 'x' } }] },
    { ...input, events: [{ ...input.events[0], stack: { groupId: 'x' } }] },
    { ...input, events: [] }
  ])('rejects obsolete or invalid input', (value) =>
    expect(ReadingReportInputSchema.safeParse(value).success).toBe(false)
  )
  it('accepts complete-artwork marking only', () => {
    const mark = { artworkId: 1, expectedUserId: 'u', readingLayoutVersion: 1 }
    expect(ReadingMarkReadInputSchema.safeParse(mark).success).toBe(true)
    expect(ReadingMarkReadInputSchema.safeParse({ ...mark, target: { kind: 'MEDIA', mediaId: 2 } }).success).toBe(false)
  })
})
