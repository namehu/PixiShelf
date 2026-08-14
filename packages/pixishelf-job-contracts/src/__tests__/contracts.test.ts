import { describe, expect, it } from 'vitest'
import {
  ACTIVE_JOB_STATUSES,
  EXECUTING_JOB_STATUSES,
  JOB_DEFINITION_VERSION,
  JOB_PAYLOAD_SCHEMAS,
  JOB_TYPE_VALUES,
  MEDIA_FILE_EXTENSIONS,
  TERMINAL_JOB_STATUSES,
  VIDEO_FILE_EXTENSIONS,
  bigintStringSchema,
  jobEventDtoSchema,
  parseJobPayload,
  relativePathSchema,
  workerHealthDtoSchema
} from '../index.js'

describe('job wire contracts', () => {
  it('defines every existing job family and a disjoint lifecycle classification', () => {
    expect(JOB_TYPE_VALUES).toEqual(
      expect.arrayContaining([
        'SCAN',
        'PENDING_REPLACE',
        'VIDEO_MEDIA_PROBE',
        'VIDEO_KEYFRAME_DISCOVERY',
        'VIDEO_KEYFRAME_GENERATION',
        'ARCHIVE_IMPORT'
      ])
    )
    expect(TERMINAL_JOB_STATUSES).toContain('SKIPPED')
    expect(ACTIVE_JOB_STATUSES).toContain('RETRY_WAIT')
    expect(EXECUTING_JOB_STATUSES).toEqual(new Set(['RUNNING', 'PAUSING', 'CANCELLING']))
    expect([...TERMINAL_JOB_STATUSES].some((status) => ACTIVE_JOB_STATUSES.has(status))).toBe(false)
    expect(Object.keys(JOB_PAYLOAD_SCHEMAS)).toHaveLength(JOB_TYPE_VALUES.length)
    expect(JOB_DEFINITION_VERSION).toBe(1)
  })

  it('publishes one immutable media extension vocabulary including m4v', () => {
    expect(VIDEO_FILE_EXTENSIONS).toContain('.m4v')
    expect(MEDIA_FILE_EXTENSIONS).toEqual(expect.arrayContaining([...VIDEO_FILE_EXTENSIONS]))
    expect(Object.isFrozen(VIDEO_FILE_EXTENSIONS)).toBe(true)
    expect(Object.isFrozen(MEDIA_FILE_EXTENSIONS)).toBe(true)
  })

  it('rejects absolute and traversing payload paths', () => {
    expect(relativePathSchema.parse('artist/work/video.mp4')).toBe('artist/work/video.mp4')
    expect(() => relativePathSchema.parse('../outside.mp4')).toThrow()
    expect(() => relativePathSchema.parse('/absolute/video.mp4')).toThrow()
    expect(() => relativePathSchema.parse('C:\\media\\video.mp4')).toThrow()
  })

  it('requires force for durable single-image reprobe and bounds explicit GC batches', () => {
    expect(parseJobPayload('VIDEO_MEDIA_PROBE', { imageId: 7, force: true })).toEqual({
      imageId: 7,
      force: true,
      enqueueMissingPosters: true
    })
    expect(() => parseJobPayload('VIDEO_MEDIA_PROBE', { imageId: 7, force: false })).toThrow()
    expect(
      parseJobPayload('DERIVED_MEDIA_GC', {
        entryIds: Array.from({ length: 1_000 }, (_, index) => `gc-${index}`),
        dryRun: false
      })
    ).toMatchObject({ dryRun: false, reconcile: false })
    expect(() =>
      parseJobPayload('DERIVED_MEDIA_GC', {
        entryIds: Array.from({ length: 1_001 }, (_, index) => `gc-${index}`)
      })
    ).toThrow()
  })

  it('keeps bigint and timestamps in JSON-safe string form', () => {
    expect(bigintStringSchema.parse('9223372036854775807')).toBe('9223372036854775807')
    expect(() => bigintStringSchema.parse(1n)).toThrow()

    const event = {
      id: '12',
      jobId: 'job-1',
      type: 'job.progress',
      level: 'INFO',
      attempt: 1,
      workerId: 'worker-1',
      stage: 'PROBING',
      progress: 50,
      message: null,
      data: { processed: 5 },
      createdAt: '2026-08-14T10:00:00.000Z'
    }
    expect(jobEventDtoSchema.parse(event)).toEqual(event)
    expect(() => jobEventDtoSchema.parse({ ...event, createdAt: new Date() })).toThrow()
  })

  it('validates the WorkerInstance wire shape without Date values', () => {
    const worker = {
      workerId: 'worker-1',
      status: 'READY',
      serviceVersion: '1.0.0',
      hostname: 'worker-host',
      processId: 42,
      capabilities: [{ jobType: 'VIDEO_MEDIA_PROBE', definitionVersions: [1] }],
      startedAt: '2026-08-14T10:00:00.000Z',
      heartbeatAt: '2026-08-14T10:00:30.000Z',
      lastError: null,
      updatedAt: '2026-08-14T10:00:30.000Z'
    }
    expect(workerHealthDtoSchema.parse(worker)).toEqual(worker)
    expect(() => workerHealthDtoSchema.parse({ ...worker, heartbeatAt: new Date() })).toThrow()
    expect(() => workerHealthDtoSchema.parse({ ...worker, workerId: 'x'.repeat(121) })).toThrow()
    expect(() =>
      workerHealthDtoSchema.parse({
        ...worker,
        capabilities: [{ jobType: 'VIDEO_MEDIA_PROBE', definitionVersions: [1, 1] }]
      })
    ).toThrow()
    expect(() => workerHealthDtoSchema.parse({ ...worker, lastError: 'x'.repeat(2049) })).toThrow()
  })
})
