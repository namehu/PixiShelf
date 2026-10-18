import { expect, it } from 'vitest'
import { ReadingReportInputSchema } from '../reading.dto'

it.each([
  { currentTime: -1, duration: 100 },
  { currentTime: 1, duration: -100 },
  { currentTime: NaN, duration: 100 },
  { currentTime: 1, duration: Infinity }
])('rejects malformed playback evidence %o', (playback) => {
  expect(ReadingReportInputSchema.safeParse({
    artworkId: 1, expectedUserId: 'alice', mediaRevision: 1,
    events: [{ type: 'VIEW', mediaId: 1, observedAt: new Date().toISOString(), playback }]
  }).success).toBe(false)
})
