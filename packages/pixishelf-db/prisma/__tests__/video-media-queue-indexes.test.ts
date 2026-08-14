import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const prismaDirectory = path.resolve(process.cwd(), 'prisma')
const schema = readFileSync(path.join(prismaDirectory, 'schema.prisma'), 'utf8')
const migration = readFileSync(
  path.join(prismaDirectory, 'migrations', '20260815001000_add_video_media_queue_indexes', 'migration.sql'),
  'utf8'
)
const probeIndexName = 'MediaVideoMetadata_probeStatus_imageId_idx'
const posterBacklogIndexName = 'MediaVideoMetadata_poster_backlog_idx'

describe('video media worker query indexes', () => {
  it('keeps probe cursor and bounded poster backlog access paths in schema and migration', () => {
    expect(schema).toContain('@@index([probeStatus, imageId])')
    expect(schema).toContain('posterBacklogCheckedAt    DateTime?')
    expect(schema).toContain(
      '@@index([probeStatus, manualPosterTimestamp, posterBacklogCheckedAt, imageId], map: "MediaVideoMetadata_poster_backlog_idx")'
    )
    expect(migration).toContain(`"${probeIndexName}"`)
    expect(migration).toContain('ADD COLUMN "posterBacklogCheckedAt" TIMESTAMP(3)')
    expect(migration).toContain(`"${posterBacklogIndexName}"`)
    expect(migration).toContain('"posterBacklogCheckedAt" ASC NULLS FIRST')
    expect(migration).toContain('"imageId" ASC')
    expect(Buffer.byteLength(probeIndexName, 'utf8')).toBeLessThanOrEqual(63)
    expect(Buffer.byteLength(posterBacklogIndexName, 'utf8')).toBeLessThanOrEqual(63)
  })
})
