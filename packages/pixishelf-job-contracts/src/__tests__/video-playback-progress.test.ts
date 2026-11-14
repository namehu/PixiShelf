import { describe, expect, it } from 'vitest'
import { jobDtoSchema, jobLiveSummarySchema } from '../dtos.ts'
import { videoPlaybackProgressDataSchema } from '../job-progress-data.ts'

const snapshot = {
  version: 1,
  kind: 'video-playback',
  stage: 'ENCODING',
  durationSeconds: 440,
  encodedSeconds: 100,
  speed: 0.4,
  fps: 12,
  etaSeconds: 850,
  sampledAt: '2026-11-14T05:07:25.000Z',
  stages: [{ stage: 'ENCODING', startedAt: '2026-11-14T05:03:15.000Z', finishedAt: null }]
}
describe('playback progress wire contract', () => {
  it('retains the same snapshot in detail and SSE, while old jobs remain null', () => {
    for (const schema of [jobDtoSchema.shape.progressData, jobLiveSummarySchema.shape.progressData]) {
      expect(schema.parse(snapshot)).toEqual(snapshot)
      expect(schema.parse(null)).toBeNull()
    }
  })
  it('rejects invalid measurements, future versions and private fields at the boundary', () => {
    for (const patch of [
      { speed: Infinity },
      { fps: -1 },
      { etaSeconds: -1 },
      { version: 2 },
      { sourcePath: '/private/movie.mp4' }
    ]) {
      expect(videoPlaybackProgressDataSchema.safeParse({ ...snapshot, ...patch }).success).toBe(false)
    }
  })
})
