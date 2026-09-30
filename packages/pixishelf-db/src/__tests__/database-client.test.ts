import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { assertBackgroundQueueSchema } from '../index'

const queueKernelDatabaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = queueKernelDatabaseUrl ? describe : describe.skip
const postgresClient = queueKernelDatabaseUrl ? new PrismaClient({ datasourceUrl: queueKernelDatabaseUrl }) : null
const latestMigration = '20260930121000_retire_series_legacy_fields'

const expectedIndex = {
  indexName: 'system_jobs_single_executing_per_lane_idx',
  indexPredicate:
    '(status = ANY (ARRAY[\'RUNNING\'::"JobStatus", \'PAUSING\'::"JobStatus", \'CANCELLING\'::"JobStatus"]))',
  indexExpression: '"executionLane"',
  keyCount: 1
}

const completeTableRows = [
  'artist_merges',
  'ImageAnimationMetadata',
  'artwork_reading_summaries',
  'artwork_read_media',
  'creator_maintenance_plans',
  'creator_maintenance_items',
  'artwork_artists',
  'artwork_artist_evidence',
  'artist_source_tag_mappings',
  'effective_artwork_creators',
  'archive_intake_items',
  'archive_uploader_scan_items',
  'archive_uploader_scan_runs',
  'archive_uploader_sources',
  'archive_provider_request_leases',
  'archive_provider_throttles',
  'archive_resolve_queue_control',
  'derived_media_gc_entries',
  'job_resource_leases',
  'pixiv_metadata_inventory',
  'pixiv_metadata_inventory_state',
  'pixiv_source_audit_items',
  'tag_external_metadata',
  'system_job_events',
  'worker_instances'
].map((tableName) => ({ tableName }))

function createQueryClient(results: unknown[]): PrismaClient {
  return {
    $queryRaw: vi.fn().mockImplementation(() => Promise.resolve(results.shift()))
  } as unknown as PrismaClient
}

describe('database package', () => {
  it('accepts the complete background queue schema contract', async () => {
    const client = createQueryClient([
      [{ columnName: 'definitionVersion' }, { columnName: 'executionLane' }, { columnName: 'progressData' }, { columnName: 'Artwork.mediaRevision' }],
      completeTableRows,
      [{ migrationName: latestMigration }],
      [expectedIndex]
    ])

    await expect(assertBackgroundQueueSchema(client)).resolves.toBeUndefined()
  })

  it('rejects a migrated database missing the animation metadata table', async () => {
    const client = createQueryClient([
      [{ columnName: 'definitionVersion' }, { columnName: 'executionLane' }, { columnName: 'progressData' }, { columnName: 'Artwork.mediaRevision' }],
      completeTableRows.filter(({ tableName }) => tableName !== 'ImageAnimationMetadata'),
      [{ migrationName: latestMigration }],
      [expectedIndex]
    ])

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      'Background queue schema is not ready: missing ImageAnimationMetadata'
    )
  })

  it.each(['artwork_reading_summaries', 'artwork_read_media'])(
    'rejects a migrated database missing %s',
    async (missingTable) => {
      const client = createQueryClient([
        [{ columnName: 'definitionVersion' }, { columnName: 'executionLane' }, { columnName: 'progressData' }, { columnName: 'Artwork.mediaRevision' }],
        completeTableRows.filter(({ tableName }) => tableName !== missingTable),
        [{ migrationName: latestMigration }],
        [expectedIndex]
      ])

      await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(`Background queue schema is not ready: missing ${missingTable}`)
    }
  )

  it('rejects a migrated database missing Artwork.mediaRevision', async () => {
    const client = createQueryClient([
      [{ columnName: 'definitionVersion' }, { columnName: 'executionLane' }, { columnName: 'progressData' }],
      completeTableRows,
      [{ migrationName: latestMigration }],
      [expectedIndex]
    ])

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      'Background queue schema is not ready: missing Artwork.mediaRevision'
    )
  })

  it.each(['userId', 'seriesId', 'source', 'externalId'])(
    'rejects the retired legacy column %s even when current queue objects exist',
    async (retiredColumn) => {
      const client = createQueryClient([
        [
          { columnName: 'definitionVersion' },
          { columnName: 'executionLane' },
          { columnName: 'progressData' },
          { columnName: 'Artwork.mediaRevision' },
          { columnName: retiredColumn }
        ],
        completeTableRows,
        [{ migrationName: latestMigration }],
        [expectedIndex]
      ])

      await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(`retired-column:${retiredColumn}`)
    }
  )

  it('reports missing required objects without exposing connection details', async () => {
    const client = createQueryClient([[], [], [], []])

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      `Background queue schema is not ready: missing system_jobs.definitionVersion, system_jobs.executionLane, system_jobs.progressData, Artwork.mediaRevision, artist_merges, ImageAnimationMetadata, artwork_reading_summaries, artwork_read_media, creator_maintenance_plans, creator_maintenance_items, artwork_artists, artwork_artist_evidence, artist_source_tag_mappings, effective_artwork_creators, archive_intake_items, archive_uploader_scan_items, archive_uploader_scan_runs, archive_uploader_sources, archive_provider_request_leases, archive_provider_throttles, archive_resolve_queue_control, derived_media_gc_entries, job_resource_leases, pixiv_metadata_inventory, pixiv_metadata_inventory_state, pixiv_source_audit_items, tag_external_metadata, system_job_events, worker_instances, migration:${latestMigration}, index:system_jobs_single_executing_per_lane_idx`
    )
  })

  it('rejects a database that stopped before the reading migration', async () => {
    const client = createQueryClient([
      [{ columnName: 'definitionVersion' }, { columnName: 'executionLane' }, { columnName: 'progressData' }, { columnName: 'Artwork.mediaRevision' }],
      [
        { tableName: 'artist_merges' },
        { tableName: 'ImageAnimationMetadata' },
        { tableName: 'artwork_reading_summaries' },
        { tableName: 'artwork_read_media' },
        { tableName: 'creator_maintenance_plans' },
        { tableName: 'creator_maintenance_items' },
        { tableName: 'artwork_artists' },
        { tableName: 'artwork_artist_evidence' },
        { tableName: 'artist_source_tag_mappings' },
        { tableName: 'effective_artwork_creators' },
        { tableName: 'archive_intake_items' },
        { tableName: 'archive_uploader_scan_items' },
        { tableName: 'archive_uploader_scan_runs' },
        { tableName: 'archive_uploader_sources' },
        { tableName: 'archive_provider_request_leases' },
        { tableName: 'archive_provider_throttles' },
        { tableName: 'archive_resolve_queue_control' },
        { tableName: 'derived_media_gc_entries' },
        { tableName: 'job_resource_leases' },
        { tableName: 'pixiv_metadata_inventory' },
        { tableName: 'pixiv_metadata_inventory_state' },
        { tableName: 'pixiv_source_audit_items' },
        { tableName: 'tag_external_metadata' },
        { tableName: 'system_job_events' },
        { tableName: 'worker_instances' }
      ],
      [{ migrationName: '20260924120000_add_image_animation_duration_metadata' }],
      [expectedIndex]
    ])

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      `Background queue schema is not ready: missing migration:${latestMigration}`
    )
  })

  it('rejects a migrated schema when the single-execution index is missing or invalid', async () => {
    const client = createQueryClient([
      [{ columnName: 'definitionVersion' }, { columnName: 'executionLane' }, { columnName: 'progressData' }, { columnName: 'Artwork.mediaRevision' }],
      [
        { tableName: 'artist_merges' },
        { tableName: 'ImageAnimationMetadata' },
        { tableName: 'artwork_reading_summaries' },
        { tableName: 'artwork_read_media' },
        { tableName: 'creator_maintenance_plans' },
        { tableName: 'creator_maintenance_items' },
        { tableName: 'artwork_artists' },
        { tableName: 'artwork_artist_evidence' },
        { tableName: 'artist_source_tag_mappings' },
        { tableName: 'effective_artwork_creators' },
        { tableName: 'archive_intake_items' },
        { tableName: 'archive_uploader_scan_items' },
        { tableName: 'archive_uploader_scan_runs' },
        { tableName: 'archive_uploader_sources' },
        { tableName: 'archive_provider_request_leases' },
        { tableName: 'archive_provider_throttles' },
        { tableName: 'archive_resolve_queue_control' },
        { tableName: 'derived_media_gc_entries' },
        { tableName: 'job_resource_leases' },
        { tableName: 'pixiv_metadata_inventory' },
        { tableName: 'pixiv_metadata_inventory_state' },
        { tableName: 'pixiv_source_audit_items' },
        { tableName: 'tag_external_metadata' },
        { tableName: 'system_job_events' },
        { tableName: 'worker_instances' }
      ],
      [{ migrationName: latestMigration }],
      []
    ])

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      'Background queue schema is not ready: missing index:system_jobs_single_executing_per_lane_idx'
    )
  })

  it('rejects a same-name unique partial index with the wrong protected statuses', async () => {
    const client = createQueryClient([
      [{ columnName: 'definitionVersion' }, { columnName: 'executionLane' }, { columnName: 'progressData' }, { columnName: 'Artwork.mediaRevision' }],
      [
        { tableName: 'artist_merges' },
        { tableName: 'ImageAnimationMetadata' },
        { tableName: 'artwork_reading_summaries' },
        { tableName: 'artwork_read_media' },
        { tableName: 'creator_maintenance_plans' },
        { tableName: 'creator_maintenance_items' },
        { tableName: 'artwork_artists' },
        { tableName: 'artwork_artist_evidence' },
        { tableName: 'artist_source_tag_mappings' },
        { tableName: 'effective_artwork_creators' },
        { tableName: 'archive_intake_items' },
        { tableName: 'archive_uploader_scan_items' },
        { tableName: 'archive_uploader_scan_runs' },
        { tableName: 'archive_uploader_sources' },
        { tableName: 'archive_provider_request_leases' },
        { tableName: 'archive_provider_throttles' },
        { tableName: 'archive_resolve_queue_control' },
        { tableName: 'derived_media_gc_entries' },
        { tableName: 'job_resource_leases' },
        { tableName: 'pixiv_metadata_inventory' },
        { tableName: 'pixiv_metadata_inventory_state' },
        { tableName: 'pixiv_source_audit_items' },
        { tableName: 'tag_external_metadata' },
        { tableName: 'system_job_events' },
        { tableName: 'worker_instances' }
      ],
      [{ migrationName: latestMigration }],
      [
        {
          ...expectedIndex,
          indexPredicate: '(status = ANY (ARRAY[\'RUNNING\'::"JobStatus", \'PAUSING\'::"JobStatus"]))'
        }
      ]
    ])

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      'Background queue schema is not ready: missing index:system_jobs_single_executing_per_lane_idx'
    )
  })

  it('rejects a same-name partial index that is not keyed by execution lane', async () => {
    const client = createQueryClient([
      [{ columnName: 'definitionVersion' }, { columnName: 'executionLane' }, { columnName: 'progressData' }, { columnName: 'Artwork.mediaRevision' }],
      [
        { tableName: 'artist_merges' },
        { tableName: 'ImageAnimationMetadata' },
        { tableName: 'artwork_reading_summaries' },
        { tableName: 'artwork_read_media' },
        { tableName: 'creator_maintenance_plans' },
        { tableName: 'creator_maintenance_items' },
        { tableName: 'artwork_artists' },
        { tableName: 'artwork_artist_evidence' },
        { tableName: 'artist_source_tag_mappings' },
        { tableName: 'effective_artwork_creators' },
        { tableName: 'archive_intake_items' },
        { tableName: 'archive_uploader_scan_items' },
        { tableName: 'archive_uploader_scan_runs' },
        { tableName: 'archive_uploader_sources' },
        { tableName: 'archive_provider_request_leases' },
        { tableName: 'archive_provider_throttles' },
        { tableName: 'archive_resolve_queue_control' },
        { tableName: 'derived_media_gc_entries' },
        { tableName: 'job_resource_leases' },
        { tableName: 'pixiv_metadata_inventory' },
        { tableName: 'pixiv_metadata_inventory_state' },
        { tableName: 'pixiv_source_audit_items' },
        { tableName: 'tag_external_metadata' },
        { tableName: 'system_job_events' },
        { tableName: 'worker_instances' }
      ],
      [{ migrationName: latestMigration }],
      [{ ...expectedIndex, indexExpression: 'id' }]
    ])

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      'Background queue schema is not ready: missing index:system_jobs_single_executing_per_lane_idx'
    )
  })

  it('sanitizes query failures', async () => {
    const client = {
      $queryRaw: vi
        .fn()
        .mockRejectedValue(new Error('postgresql://secret-user:secret-password@database.invalid/pixishelf'))
    } as unknown as PrismaClient

    await expect(assertBackgroundQueueSchema(client)).rejects.toThrow(
      'Unable to verify the background queue database schema'
    )
    await expect(assertBackgroundQueueSchema(client)).rejects.not.toThrow('secret-password')
  })
})

describePostgres('database package PostgreSQL integration', () => {
  afterAll(async () => {
    await postgresClient?.$disconnect()
  })

  it('accepts the migrated single-execution expression index from the PostgreSQL catalog', async () => {
    await expect(assertBackgroundQueueSchema(postgresClient!)).resolves.toBeUndefined()
  })

  it('rejects a real migrated catalog when Artwork.seriesId reappears', async () => {
    const rollback = new Error('rollback retired column fixture')
    try {
      await postgresClient!.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe('ALTER TABLE "Artwork" ADD COLUMN "seriesId" INTEGER')
        await expect(assertBackgroundQueueSchema(transaction as unknown as PrismaClient)).rejects.toThrow(
          'retired-column:seriesId'
        )
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
  })
})
