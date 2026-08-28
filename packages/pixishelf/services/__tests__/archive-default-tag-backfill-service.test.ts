import { describe, expect, it, vi } from 'vitest'
import {
  previewArchiveDefaultTagBackfill,
  supportsArchiveDefaultTagBackfill
} from '@/services/archive-default-tag-backfill-service'

describe('archive default-tag backfill service', () => {
  it('previews only active URL archive artworks under the frozen upper id', async () => {
    const database = {
      artwork: {
        aggregate: vi.fn().mockResolvedValue({ _max: { id: 42 } }),
        count: vi.fn().mockResolvedValue(3)
      },
      tag: { findMany: vi.fn().mockResolvedValue([{ id: 2 }, { id: 9 }]) },
      artworkTag: { count: vi.fn().mockResolvedValue(2) }
    }

    const preview = await previewArchiveDefaultTagBackfill({
      database: database as never,
      settings: { archive_default_tag_ids: [9, 7, 2, 9] }
    })

    expect(preview).toMatchObject({
      configuredTagIds: [2, 7, 9],
      validTagIds: [2, 9],
      unavailableTagIds: [7],
      targetMaxArtworkId: 42,
      targetArtworkCount: 3,
      existingRelations: 2,
      missingRelations: 4
    })
    expect(preview.snapshotDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(database.artwork.count).toHaveBeenCalledWith({
      where: {
        createdVia: 'URL_ARCHIVE',
        deletedAt: null,
        archiveLifecycleState: 'ACTIVE',
        id: { lte: 42 }
      }
    })
    expect(database.artworkTag.count).toHaveBeenCalledWith({
      where: {
        tagId: { in: [2, 9] },
        artwork: {
          createdVia: 'URL_ARCHIVE',
          deletedAt: null,
          archiveLifecycleState: 'ACTIVE',
          id: { lte: 42 }
        }
      }
    })
  })

  it('accepts only the current writer-lane capability', () => {
    expect(
      supportsArchiveDefaultTagBackfill([
        {
          jobType: 'ARCHIVE_DEFAULT_TAG_BACKFILL',
          executionLane: 'BACKGROUND_WRITER',
          definitionVersions: [1]
        }
      ])
    ).toBe(true)
    expect(
      supportsArchiveDefaultTagBackfill([
        {
          jobType: 'ARCHIVE_DEFAULT_TAG_BACKFILL',
          executionLane: 'ARCHIVE_RESOLVE',
          definitionVersions: [1]
        }
      ])
    ).toBe(false)
    expect(supportsArchiveDefaultTagBackfill(null)).toBe(false)
  })
})
