import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { mediaClassificationCases } from '../../../../pixishelf-job-contracts/src/__tests__/fixtures/media-classification.ts'
import { collectLocalMedia } from '../../scan/discovery.ts'
import { resolveSafeScanRoot } from '../../scan/paths.ts'
import { createNodePendingReplaceFileSystem } from '../file-system.ts'
import { describe, expect, it } from 'vitest'
import { buildArtworkSnapshots, buildInstalledMedia, scanPendingSource } from '../snapshot.js'
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

it('uses the same initial types and admission list for scan and pending replacement', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'media-classification-'))
  try {
    const directory = 'pending-replaces/work__ext-123'
    await mkdir(path.join(root, directory), { recursive: true })
    for (const [name] of mediaClassificationCases) await writeFile(path.join(root, directory, name), 'fixture')
    const pending = await scanPendingSource(
      {
        config: { scanRoot: root },
        fileSystem: createNodePendingReplaceFileSystem()
      } as PendingReplaceExecutorDependencies,
      'work__ext-123',
      '123'
    )
    const scanned = await collectLocalMedia(
      await resolveSafeScanRoot(root),
      directory,
      { maxEntries: 100, maxMediaPerArtwork: 100 },
      new AbortController().signal
    )
    for (const [name, kind, scan] of mediaClassificationCases) {
      const replacement = pending.media.find((item) => item.sourceName === name)
      const discovered = scanned.find((item) => item.relativePath.endsWith('/' + name))
      if (kind === 'UNKNOWN') {
        expect(replacement).toBeUndefined()
        expect(discovered).toBeUndefined()
      } else {
        expect(replacement).toMatchObject({ mediaType: kind })
        expect(discovered).toMatchObject({ mediaType: kind, webpAnimationStatus: scan ? 0 : null })
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
