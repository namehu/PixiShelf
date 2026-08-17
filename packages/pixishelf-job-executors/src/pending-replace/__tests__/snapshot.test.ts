import { describe, expect, it } from 'vitest'
import { buildArtworkSnapshots, buildInstalledMedia } from '../snapshot.js'
import type { PendingReplaceExecutorDependencies, PendingReplaceMediaSnapshot } from '../types.js'

const digest = 'a'.repeat(64)

describe('pending replacement snapshots', () => {
  it('publishes a canonical chapter path and fingerprint with its replacement media', () => {
    const media: PendingReplaceMediaSnapshot[] = [
      {
        sourceName: 'clip.mp4',
        targetName: '123_p0.mp4',
        path: '/pending-replaces/source/clip.mp4',
        size: 10,
        sha256: digest,
        width: 1,
        height: 1,
        order: 0,
        mtimeMs: 1,
        mediaType: 'VIDEO'
      }
    ]
    expect(
      buildInstalledMedia('/artworks/123', media, [
        {
          name: 'clip.mp4.chapters.json',
          targetName: '123_p0.mp4.chapters.json',
          relatedMediaName: 'clip.mp4',
          kind: 'chapter',
          size: 20,
          mtimeMs: 2,
          sha256: digest
        }
      ])
    ).toEqual([
      expect.objectContaining({
        path: '/artworks/123/123_p0.mp4',
        chaptersPath: '/artworks/123/123_p0.mp4.chapters.json',
        chaptersMtimeMs: 2,
        chaptersSha256: digest
      })
    ])
  })

  it('rejects a database media path outside the artwork stable target directory', async () => {
    await expect(
      buildArtworkSnapshots({ config: { scanRoot: 'D:/scan' } } as PendingReplaceExecutorDependencies, {
        id: 1,
        externalId: '123',
        storageKey: '123',
        title: 'Artwork',
        storagePath: '/artworks/123',
        artistName: null,
        images: [
          {
            path: '/outside/123_p0.jpg',
            sortOrder: 0,
            width: 1,
            height: 1,
            size: 1,
            mediaType: 'IMAGE',
            chaptersPath: null
          }
        ]
      })
    ).rejects.toThrow('outside its stable target directory')
  })
})
