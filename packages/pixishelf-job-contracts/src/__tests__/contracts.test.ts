import { describe, expect, it } from 'vitest'
import {
  ACTIVE_JOB_STATUSES,
  EXECUTING_JOB_STATUSES,
  executionLaneForJobType,
  JOB_DEFINITION_VERSION,
  SCAN_AUDIT_APPLY_DEFINITION_VERSION,
  SCAN_DEFINITION_VERSION,
  ARCHIVE_IMPORT_DEFINITION_VERSION,
  JOB_PAYLOAD_SCHEMAS,
  JOB_TYPE_VALUES,
  MEDIA_FILE_EXTENSIONS,
  TERMINAL_JOB_STATUSES,
  VIDEO_FILE_EXTENSIONS,
  archiveImportV2PayloadSchema,
  bigintStringSchema,
  canonicalizeAuditApplyInputs,
  jobEventDtoSchema,
  parseJobPayload,
  scanV2PayloadSchema,
  scanV3PayloadSchema,
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
        'ARCHIVE_RESOLVE_ITEM',
        'ARCHIVE_IMPORT',
        'ARCHIVE_MAINTENANCE',
        'ARCHIVE_INTAKE_RETENTION_CLEANUP',
        'PIXIV_AI_DERIVED_TAG_SYNC',
        'PIXIV_ARTWORK_ENRICHMENT',
        'PIXIV_ARTIST_ENRICHMENT',
        'PIXIV_SERIES_RECONCILIATION',
        'PIXIV_TAG_ENRICHMENT'
      ])
    )
    expect(TERMINAL_JOB_STATUSES).toContain('SKIPPED')
    expect(ACTIVE_JOB_STATUSES).toContain('RETRY_WAIT')
    expect(EXECUTING_JOB_STATUSES).toEqual(new Set(['RUNNING', 'PAUSING', 'CANCELLING']))
    expect([...TERMINAL_JOB_STATUSES].some((status) => ACTIVE_JOB_STATUSES.has(status))).toBe(false)
    expect(Object.keys(JOB_PAYLOAD_SCHEMAS)).toHaveLength(JOB_TYPE_VALUES.length)
    expect(JOB_DEFINITION_VERSION).toBe(1)
    expect(SCAN_DEFINITION_VERSION).toBe(2)
    expect(SCAN_AUDIT_APPLY_DEFINITION_VERSION).toBe(3)
    expect(ARCHIVE_IMPORT_DEFINITION_VERSION).toBe(2)
    expect(executionLaneForJobType('ARCHIVE_RESOLVE_ITEM')).toBe('ARCHIVE_RESOLVE')
    expect(executionLaneForJobType('ARCHIVE_IMPORT')).toBe('BACKGROUND_WRITER')
    expect(executionLaneForJobType('ARCHIVE_MAINTENANCE')).toBe('BACKGROUND_WRITER')
    expect(executionLaneForJobType('ARCHIVE_INTAKE_RETENTION_CLEANUP')).toBe('BACKGROUND_WRITER')
    expect(parseJobPayload('ARCHIVE_INTAKE_RETENTION_CLEANUP', {})).toEqual({})
    expect(() => parseJobPayload('ARCHIVE_INTAKE_RETENTION_CLEANUP', { retentionDays: 7 })).toThrow()
    expect(parseJobPayload('PIXIV_AI_DERIVED_TAG_SYNC', {})).toEqual({ dryRun: true })
    expect(parseJobPayload('PIXIV_AI_DERIVED_TAG_SYNC', { dryRun: false })).toEqual({ dryRun: false })
    expect(() => parseJobPayload('PIXIV_AI_DERIVED_TAG_SYNC', { dryRun: false, unexpected: true })).toThrow()
    expect(parseJobPayload('ARCHIVE_RESOLVE_ITEM', { intakeItemId: 'intake-1' })).toEqual({
      intakeItemId: 'intake-1'
    })
    expect(parseJobPayload('ARCHIVE_MAINTENANCE', { action: 'CLEAN_STAGING', archiveImportId: 'import-1' })).toEqual({
      action: 'CLEAN_STAGING',
      archiveImportId: 'import-1'
    })
    expect(parseJobPayload('ARCHIVE_MAINTENANCE', { action: 'TRASH_ARCHIVE', artworkId: 7 })).toEqual({
      action: 'TRASH_ARCHIVE',
      artworkId: 7
    })
    expect(parseJobPayload('ARCHIVE_MAINTENANCE', { action: 'PURGE_ARCHIVE', artworkId: 7 })).toEqual({
      action: 'PURGE_ARCHIVE',
      artworkId: 7
    })
    expect(parseJobPayload('ARCHIVE_MAINTENANCE', { action: 'RECONCILE' })).toEqual({ action: 'RECONCILE' })
    expect(() => parseJobPayload('ARCHIVE_MAINTENANCE', { action: 'RECONCILE', artworkId: 7 })).toThrow()
    expect(() =>
      parseJobPayload('ARCHIVE_MAINTENANCE', {
        action: 'RESTORE_ARCHIVE',
        archiveImportId: 'wrong-target'
      })
    ).toThrow()
  })

  it('publishes one immutable media extension vocabulary including m4v', () => {
    expect(VIDEO_FILE_EXTENSIONS).toContain('.m4v')
    expect(MEDIA_FILE_EXTENSIONS).toEqual(expect.arrayContaining([...VIDEO_FILE_EXTENSIONS]))
    expect(Object.isFrozen(VIDEO_FILE_EXTENSIONS)).toBe(true)
    expect(Object.isFrozen(MEDIA_FILE_EXTENSIONS)).toBe(true)
  })

  it('freezes canonical default tag ids in ARCHIVE_IMPORT v2 while keeping v1 compatible', () => {
    expect(parseJobPayload('ARCHIVE_IMPORT', { archiveImportId: 'import-1' })).toEqual({ archiveImportId: 'import-1' })
    expect(archiveImportV2PayloadSchema.parse({ archiveImportId: 'import-1', defaultTagIds: [9, 2, 5] })).toEqual({
      archiveImportId: 'import-1',
      defaultTagIds: [2, 5, 9]
    })
    expect(() => archiveImportV2PayloadSchema.parse({ archiveImportId: 'import-1' })).toThrow()
    expect(() =>
      archiveImportV2PayloadSchema.parse({ archiveImportId: 'import-1', defaultTagIds: [2, 2] })
    ).toThrow()
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
      force: true
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
    expect(parseJobPayload('PIXIV_TAG_ENRICHMENT', { mode: 'DISCOVER' })).toEqual({
      mode: 'DISCOVER',
      force: false,
      refreshExisting: false
    })
    expect(
      parseJobPayload('PIXIV_TAG_ENRICHMENT', {
        mode: 'DISCOVER',
        force: true,
        tagIds: [3, 7]
      })
    ).toEqual({ mode: 'DISCOVER', force: true, refreshExisting: false, tagIds: [3, 7] })
    expect(
      parseJobPayload('PIXIV_TAG_ENRICHMENT', {
        mode: 'DISCOVER',
        refreshExisting: true,
        tagIds: [3, 7]
      })
    ).toEqual({ mode: 'DISCOVER', force: false, refreshExisting: true, tagIds: [3, 7] })
    expect(() =>
      parseJobPayload('PIXIV_TAG_ENRICHMENT', {
        mode: 'DISCOVER',
        tagIds: Array.from({ length: 1_001 }, (_, index) => index + 1)
      })
    ).toThrow()
    expect(
      parseJobPayload('PIXIV_TAG_ENRICHMENT', {
        mode: 'TAG',
        tagId: 7,
        expectedName: '  original-tag  ',
        force: true
      })
    ).toEqual({
      mode: 'TAG',
      tagId: 7,
      expectedName: 'original-tag',
      force: true,
      refreshExisting: false
    })
    expect(() => parseJobPayload('PIXIV_TAG_ENRICHMENT', { mode: 'TAG', tagId: 0, expectedName: 'tag' })).toThrow()
    expect(parseJobPayload('PIXIV_ARTWORK_ENRICHMENT', { mode: 'DISCOVER' })).toEqual({
      mode: 'DISCOVER',
      refreshExisting: false,
      adoptSourceText: false
    })
    expect(
      parseJobPayload('PIXIV_ARTWORK_ENRICHMENT', {
        mode: 'DISCOVER',
        refreshExisting: true,
        adoptSourceText: true,
        artworkIds: [3, 7]
      })
    ).toEqual({
      mode: 'DISCOVER',
      refreshExisting: true,
      adoptSourceText: true,
      artworkIds: [3, 7]
    })
    expect(
      parseJobPayload('PIXIV_ARTWORK_ENRICHMENT', {
        mode: 'ARTWORK',
        artworkId: 7,
        expectedExternalRefId: 'ref-7',
        expectedPixivArtworkId: '123'
      })
    ).toEqual({
      mode: 'ARTWORK',
      artworkId: 7,
      expectedExternalRefId: 'ref-7',
      expectedPixivArtworkId: '123',
      adoptSourceText: false
    })
    expect(() =>
      parseJobPayload('PIXIV_ARTWORK_ENRICHMENT', {
        mode: 'DISCOVER',
        artworkIds: Array.from({ length: 201 }, (_, index) => index + 1)
      })
    ).toThrow()
    expect(parseJobPayload('PIXIV_SERIES_RECONCILIATION', { mode: 'DISCOVER' })).toEqual({
      mode: 'DISCOVER',
      refreshExisting: false
    })
    expect(
      parseJobPayload('PIXIV_SERIES_RECONCILIATION', {
        mode: 'ARTWORK',
        artworkId: 7,
        expectedExternalRefId: 'ref-7',
        expectedPixivArtworkId: '123'
      })
    ).toEqual({
      mode: 'ARTWORK',
      artworkId: 7,
      expectedExternalRefId: 'ref-7',
      expectedPixivArtworkId: '123',
      refreshExisting: false
    })
    expect(() =>
      parseJobPayload('PIXIV_SERIES_RECONCILIATION', {
        mode: 'DISCOVER',
        artworkIds: Array.from({ length: 201 }, (_, index) => index + 1)
      })
    ).toThrow()
    expect(parseJobPayload('PIXIV_ARTIST_ENRICHMENT', { mode: 'DISCOVER' })).toEqual({
      mode: 'DISCOVER',
      force: false,
      refreshExisting: false
    })
    expect(
      parseJobPayload('PIXIV_ARTIST_ENRICHMENT', {
        mode: 'DISCOVER',
        refreshExisting: true,
        artistIds: [3, 7]
      })
    ).toEqual({
      mode: 'DISCOVER',
      force: false,
      refreshExisting: true,
      artistIds: [3, 7]
    })
    expect(
      parseJobPayload('PIXIV_ARTIST_ENRICHMENT', {
        mode: 'ARTIST',
        artistId: 7,
        expectedExternalRefId: 'ref-7',
        expectedPixivUserId: '123',
        force: true
      })
    ).toEqual({
      mode: 'ARTIST',
      artistId: 7,
      expectedExternalRefId: 'ref-7',
      expectedPixivUserId: '123',
      force: true,
      refreshExisting: false
    })
  })

  it('freezes strict scan and local-import inputs instead of carrying unbounded work lists', () => {
    const digest = 'a'.repeat(64)
    expect(
      parseJobPayload('SCAN', {
        mode: 'CLIENT_LIST',
        existingPolicy: 'REFRESH',
        inputCount: 10_000,
        inputDigest: digest
      })
    ).toEqual({ mode: 'CLIENT_LIST', existingPolicy: 'REFRESH', inputCount: 10_000, inputDigest: digest })
    expect(parseJobPayload('SCAN', { mode: 'ARTWORK_RESCAN', artworkId: 42 })).toEqual({
      mode: 'ARTWORK_RESCAN',
      artworkId: 42
    })
    expect(() => parseJobPayload('SCAN', { mode: 'FULL_RECONCILE' })).toThrow()
    expect(() => parseJobPayload('SCAN', { mode: 'INCREMENTAL', metadataList: ['unbounded'] })).toThrow()
    expect(() =>
      parseJobPayload('SCAN', { mode: 'CLIENT_LIST', existingPolicy: 'SKIP', inputCount: 0, inputDigest: digest })
    ).toThrow()

    expect(parseJobPayload('LOCAL_DIRECTORY_IMPORT', { mappingCount: 0, mappingDigest: digest })).toEqual({
      defaultTagIds: [],
      mappingCount: 0,
      mappingDigest: digest
    })
    expect(
      parseJobPayload('LOCAL_DIRECTORY_IMPORT', {
        defaultTagIds: [9, 2, 5],
        mappingCount: 0,
        mappingDigest: digest
      })
    ).toMatchObject({ defaultTagIds: [2, 5, 9] })
    expect(() =>
      parseJobPayload('LOCAL_DIRECTORY_IMPORT', {
        defaultTagIds: [2, 2],
        mappingCount: 1,
        mappingDigest: digest
      })
    ).toThrow()
  })

  it('keeps SCAN v1 strict while defining independent strict v2 audit payloads', () => {
    const digest = 'b'.repeat(64)
    expect(scanV2PayloadSchema.parse({ mode: 'CONSISTENCY_AUDIT', verification: 'FAST' })).toEqual({
      mode: 'CONSISTENCY_AUDIT',
      verification: 'FAST'
    })
    expect(
      scanV2PayloadSchema.parse({ mode: 'AUDIT_APPLY', auditRunId: 'audit-1', inputCount: 2, inputDigest: digest })
    ).toEqual({ mode: 'AUDIT_APPLY', auditRunId: 'audit-1', inputCount: 2, inputDigest: digest })
    expect(() => parseJobPayload('SCAN', { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' })).toThrow()
    expect(() =>
      parseJobPayload('SCAN', { mode: 'AUDIT_APPLY', auditRunId: 'audit-1', inputCount: 2, inputDigest: digest })
    ).toThrow()
    expect(() => scanV2PayloadSchema.parse({ mode: 'INCREMENTAL' })).toThrow()
    expect(() => scanV2PayloadSchema.parse({ mode: 'CONSISTENCY_AUDIT', verification: 'FULL' })).toThrow()
    expect(() =>
      scanV2PayloadSchema.parse({ mode: 'AUDIT_APPLY', auditRunId: 'audit-1', inputCount: 0, inputDigest: digest })
    ).toThrow()
    expect(() =>
      scanV2PayloadSchema.parse({
        mode: 'AUDIT_APPLY',
        auditRunId: 'audit-1',
        inputCount: 1,
        inputDigest: digest,
        unexpected: true
      })
    ).toThrow()
    expect(
      scanV3PayloadSchema.parse({ mode: 'AUDIT_APPLY', auditRunId: 'audit-1', inputCount: 2, inputDigest: digest })
    ).toEqual({
      mode: 'AUDIT_APPLY',
      auditRunId: 'audit-1',
      inputCount: 2,
      inputDigest: digest
    })
    expect(() => scanV3PayloadSchema.parse({ mode: 'CONSISTENCY_AUDIT', verification: 'FAST' })).toThrow()
  })

  it('canonicalizes complete audit apply evidence without depending on input order', () => {
    const base = {
      sourceAuditItemId: 'audit-item-1',
      auditDifferenceKind: 'CHANGED' as const,
      relativePath: '123/123.json',
      expectedExternalId: '123',
      observedExternalId: '123',
      expectedInventoryId: 'inventory-1',
      expectedExternalRefId: 'ref-1',
      expectedArtworkId: 42,
      observedContentHash: 'a'.repeat(64),
      processedContentHash: 'b'.repeat(64),
      sizeBytes: 100n,
      mtimeMs: 200n,
      ctimeMs: 300n,
      deviceId: 400n,
      inode: 500n
    }
    const rows = [
      { ...base, ordinal: 1, sourceAuditItemId: 'audit-item-2', relativePath: '124/124.json' },
      { ...base, ordinal: 0 }
    ]
    const canonical = canonicalizeAuditApplyInputs('audit-run-1', rows)

    expect(canonical).toBe(canonicalizeAuditApplyInputs('audit-run-1', [...rows].reverse()))
    expect(canonical).not.toBe(
      canonicalizeAuditApplyInputs(
        'audit-run-1',
        rows.map((row) => ({ ...row, inode: row.inode + 1n }))
      )
    )
    expect(canonical).not.toBe(canonicalizeAuditApplyInputs('audit-run-2', rows))
    expect(() => canonicalizeAuditApplyInputs('audit-run-1', [rows[0]!, { ...rows[1]!, ordinal: 1 }])).toThrow(
      'unique audit apply input ordinals'
    )
    expect(() => canonicalizeAuditApplyInputs('audit-run-1', [{ ...base, ordinal: 2 }])).toThrow(
      'contiguous audit apply input ordinals'
    )
  })

  it('canonicalizes migration selection while keeping operational tuning out of durable payloads', () => {
    const safety = { transferMode: 'copy', verifyAfterCopy: true, cleanupSource: false }
    const first = parseJobPayload('MIGRATION', {
      selection: { mode: 'ARTWORK_IDS', artworkIds: [9, 3, 9, 5] },
      safety
    })
    const second = parseJobPayload('MIGRATION', {
      selection: { mode: 'ARTWORK_IDS', artworkIds: [5, 9, 3] },
      safety
    })
    expect(first).toEqual(second)
    expect(first).toMatchObject({ selection: { mode: 'ARTWORK_IDS', artworkIds: [3, 5, 9] } })
    expect(() =>
      parseJobPayload('MIGRATION', {
        selection: { mode: 'ARTWORK_IDS', artworkIds: [3] },
        safety,
        batchSize: 100
      })
    ).toThrow()
  })

  it('validates frozen migration query bounds, media vocabulary, and calendar dates', () => {
    expect(
      parseJobPayload('MIGRATION', {
        selection: {
          mode: 'QUERY',
          upperArtworkId: 900,
          filters: {
            search: 'landscape',
            startDate: '2026-08-01',
            endDate: '2026-08-31',
            mediaTypes: ['.m4v', '.jpg']
          }
        }
      })
    ).toMatchObject({
      selection: {
        mode: 'QUERY',
        upperArtworkId: 900,
        filters: { exactMatch: false, mediaTypes: ['.jpg', '.m4v'] }
      },
      safety: { transferMode: 'move', verifyAfterCopy: true, cleanupSource: true }
    })
    expect(() =>
      parseJobPayload('MIGRATION', {
        selection: {
          mode: 'QUERY',
          upperArtworkId: 1,
          filters: { startDate: '2026-02-30', mediaTypes: ['.exe'] }
        }
      })
    ).toThrow()
  })

  it('uses strict bounded pending-replace operation payloads', () => {
    expect(
      parseJobPayload('PENDING_REPLACE', {
        mode: 'DISCOVER',
        batchId: 'batch-1',
        sourceRoot: 'pending-replaces'
      })
    ).toEqual({ mode: 'DISCOVER', batchId: 'batch-1', sourceRoot: 'pending-replaces' })
    expect(
      parseJobPayload('PENDING_REPLACE', {
        mode: 'BATCH',
        batchId: 'batch-1',
        itemIds: ['item-2', 'item-1'],
        appendTagIds: [5, 2]
      })
    ).toMatchObject({ mode: 'BATCH', itemIds: ['item-1', 'item-2'], appendTagIds: [2, 5] })
    expect(() =>
      parseJobPayload('PENDING_REPLACE', {
        mode: 'BATCH',
        batchId: 'batch-1',
        itemIds: ['item-1', 'item-1'],
        appendTagIds: []
      })
    ).toThrow()
    expect(() =>
      parseJobPayload('PENDING_REPLACE', {
        mode: 'DISCOVER',
        batchId: 'batch-1',
        sourceRoot: 'somewhere-else'
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
      capabilities: [{ jobType: 'VIDEO_MEDIA_PROBE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }],
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
        capabilities: [{ jobType: 'VIDEO_MEDIA_PROBE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 1] }]
      })
    ).toThrow()
    expect(() => workerHealthDtoSchema.parse({ ...worker, lastError: 'x'.repeat(2049) })).toThrow()
  })
})
