import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectArtworkMedia,
  discoverLocalWorkPages,
  discoverMetadataCandidatePages,
  type ScanDiscoveryLimits
} from '../discovery.js'
import { resolveSafeScanRoot } from '../paths.js'

const roots: string[] = []
const limits: ScanDiscoveryLimits = { pageSize: 2, maxDepth: 8, maxEntries: 100, maxMediaPerArtwork: 10 }

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('scan discovery', () => {
  it('deduplicates metadata globally, prefers JSON, pages inputs, and bounds media collection', async () => {
    const directory = await fixtureRoot()
    await fs.mkdir(path.join(directory, 'a'), { recursive: true })
    await fs.mkdir(path.join(directory, 'b'), { recursive: true })
    await fs.writeFile(path.join(directory, 'a', '42-meta.txt'), 'txt')
    await fs.writeFile(path.join(directory, 'b', '42-meta.json'), 'json')
    await fs.writeFile(path.join(directory, 'a', '43-meta.json'), 'json')
    await fs.writeFile(path.join(directory, 'b', '44-meta.json'), 'json')
    await fs.writeFile(path.join(directory, 'b', '42_p0.webp'), 'image')
    await fs.writeFile(path.join(directory, 'b', '42_p1.mp4'), 'video')
    const root = await resolveSafeScanRoot(directory)

    const pages = await collectPages(discoverMetadataCandidatePages(root, limits, new AbortController().signal))
    expect(pages.map((page) => page.length)).toEqual([2, 1])
    const selected42 = pages.flat().find((candidate) => candidate.artworkId === '42')!
    expect(selected42.relativePath).toBe('b/42-meta.json')
    expect(selected42.contentHash).toMatch(/^[a-f0-9]{64}$/)
    await expect(
      collectArtworkMedia(root, selected42, { maxEntries: 100, maxMediaPerArtwork: 1 }, new AbortController().signal)
    ).rejects.toMatchObject({
      code: 'INPUT_SNAPSHOT_INVALID'
    })
    await expect(
      collectArtworkMedia(root, selected42, { maxEntries: 100, maxMediaPerArtwork: 2 }, new AbortController().signal)
    ).resolves.toMatchObject([
      { relativePath: 'b/42_p0.webp', mediaType: 'IMAGE', sortOrder: 0 },
      { relativePath: 'b/42_p1.mp4', mediaType: 'VIDEO', sortOrder: 1 }
    ])
  })

  it('discovers local media and manifest works in bounded pages', async () => {
    const directory = await fixtureRoot()
    await fs.mkdir(path.join(directory, 'local', 'artist-a', 'work-1'), { recursive: true })
    await fs.mkdir(path.join(directory, 'local', 'artist-a', 'work-2'), { recursive: true })
    await fs.mkdir(path.join(directory, 'local', 'artist-b', 'work-3'), { recursive: true })
    await fs.writeFile(path.join(directory, 'local', 'artist-a', 'work-1', 'a.jpg'), 'a')
    await fs.writeFile(path.join(directory, 'local', 'artist-a', 'work-2', 'manifest.json'), '{}')
    await fs.writeFile(path.join(directory, 'local', 'artist-b', 'work-3', 'b.png'), 'b')
    const root = await resolveSafeScanRoot(directory)

    const pages = await collectPages(discoverLocalWorkPages(root, 'local', limits, new AbortController().signal))
    expect(pages.map((page) => page.length)).toEqual([2, 1])
    expect(pages.flat()).toMatchObject([
      { kind: 'MEDIA_DIRECTORY', artistDirectory: 'artist-a', relativePath: 'local/artist-a/work-1' },
      { kind: 'ARCHIVE_MANIFEST', artistDirectory: 'artist-a', relativePath: 'local/artist-a/work-2' },
      { kind: 'MEDIA_DIRECTORY', artistDirectory: 'artist-b', relativePath: 'local/artist-b/work-3' }
    ])
  })
})

async function fixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-scan-discovery-'))
  roots.push(root)
  return root
}

async function collectPages<T>(source: AsyncIterable<T[]>) {
  const pages: T[][] = []
  for await (const page of source) pages.push(page)
  return pages
}
