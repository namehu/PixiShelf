import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectArtworkMedia,
  collectLocalMedia,
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

  it('ignores manifest.json and continues discovering ordinary local media works', async () => {
    const directory = await fixtureRoot()
    await fs.mkdir(path.join(directory, 'local', 'artist-a', 'work-1'), { recursive: true })
    await fs.mkdir(path.join(directory, 'local', 'artist-a', 'work-2', 'nested-work'), { recursive: true })
    await fs.mkdir(path.join(directory, 'local', 'artist-b', 'work-3'), { recursive: true })
    await fs.writeFile(path.join(directory, 'local', 'artist-a', 'work-1', 'a.jpg'), 'a')
    await fs.writeFile(path.join(directory, 'local', 'artist-a', 'work-2', 'manifest.json'), '{}')
    await fs.writeFile(path.join(directory, 'local', 'artist-a', 'work-2', 'nested-work', 'nested.webp'), 'nested')
    await fs.writeFile(path.join(directory, 'local', 'artist-b', 'work-3', 'b.png'), 'b')
    const root = await resolveSafeScanRoot(directory)

    const pages = await collectPages(discoverLocalWorkPages(root, 'local', limits, new AbortController().signal))
    expect(pages.map((page) => page.length)).toEqual([2, 1])
    expect(pages.flat()).toMatchObject([
      { kind: 'MEDIA_DIRECTORY', artistDirectory: 'artist-a', relativePath: 'local/artist-a/work-1' },
      {
        kind: 'MEDIA_DIRECTORY',
        artistDirectory: 'artist-a',
        relativePath: 'local/artist-a/work-2/nested-work'
      },
      { kind: 'MEDIA_DIRECTORY', artistDirectory: 'artist-b', relativePath: 'local/artist-b/work-3' }
    ])
  })

  it('collects local image dimensions and the file modification time', async () => {
    const directory = await fixtureRoot()
    const work = path.join(directory, 'local', 'artist', 'work')
    const imagePath = path.join(work, 'image.png')
    const modifiedAt = new Date('2024-01-02T03:04:05.000Z')
    await fs.mkdir(work, { recursive: true })
    await sharp({ create: { width: 7, height: 5, channels: 3, background: '#ffffff' } })
      .png()
      .toFile(imagePath)
    await fs.utimes(imagePath, modifiedAt, modifiedAt)
    const root = await resolveSafeScanRoot(directory)

    const media = await collectLocalMedia(root, 'local/artist/work', limits, new AbortController().signal)

    expect(media).toHaveLength(1)
    expect(media[0]).toMatchObject({ width: 7, height: 5 })
    expect(media[0]!.modifiedAt.getTime()).toBe(modifiedAt.getTime())
  })

  it('discovers the canonical Pixiv chapter manifest beside a real page-style video name', async () => {
    const directory = await fixtureRoot()
    const artworkDirectory = path.join(directory, '11', '140998595')
    await fs.mkdir(artworkDirectory, { recursive: true })
    await fs.writeFile(path.join(artworkDirectory, '140998595-meta.json'), '{}')
    await fs.writeFile(path.join(artworkDirectory, '140998595_p4.mp4'), 'video')
    await fs.writeFile(
      path.join(artworkDirectory, '140998595_p4.chapters.json'),
      JSON.stringify(chapterManifest(60, 6))
    )
    const root = await resolveSafeScanRoot(directory)
    const candidates = (
      await collectPages(discoverMetadataCandidatePages(root, limits, new AbortController().signal))
    ).flat()

    await expect(
      collectArtworkMedia(root, candidates[0]!, limits, new AbortController().signal)
    ).resolves.toMatchObject([
      {
        relativePath: '11/140998595/140998595_p4.mp4',
        chaptersPath: '11/140998595/140998595_p4.chapters.json',
        chaptersCount: 6,
        chaptersDuration: 60,
        chaptersHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    ])
  })

  it('prefers canonical, then full-filename, then legacy double-dot chapter manifests', async () => {
    const directory = await fixtureRoot()
    const work = path.join(directory, 'local', 'artist', 'work')
    await fs.mkdir(work, { recursive: true })
    await fs.writeFile(path.join(work, 'clip.mp4'), 'video')
    await fs.writeFile(path.join(work, 'clip.chapters.json'), JSON.stringify(chapterManifest(10)))
    await fs.writeFile(path.join(work, 'clip.mp4.chapters.json'), JSON.stringify(chapterManifest(20)))
    await fs.writeFile(path.join(work, 'clip..chapters.json'), JSON.stringify(chapterManifest(30)))
    const root = await resolveSafeScanRoot(directory)
    const collect = () =>
      collectLocalMedia(root, 'local/artist/work', limits, new AbortController().signal).then((items) => items[0]!)

    await expect(collect()).resolves.toMatchObject({
      chaptersPath: 'local/artist/work/clip.chapters.json',
      chaptersDuration: 10
    })
    await fs.unlink(path.join(work, 'clip.chapters.json'))
    await expect(collect()).resolves.toMatchObject({
      chaptersPath: 'local/artist/work/clip.mp4.chapters.json',
      chaptersDuration: 20
    })
    await fs.unlink(path.join(work, 'clip.mp4.chapters.json'))
    await expect(collect()).resolves.toMatchObject({
      chaptersPath: 'local/artist/work/clip..chapters.json',
      chaptersDuration: 30
    })
  })

  it('fails scanning when the preferred chapter manifest is corrupt instead of hiding it as absent', async () => {
    const directory = await fixtureRoot()
    const work = path.join(directory, 'local', 'artist', 'work')
    await fs.mkdir(work, { recursive: true })
    await fs.writeFile(path.join(work, 'clip.mp4'), 'video')
    await fs.writeFile(path.join(work, 'clip.chapters.json'), '{broken')
    await fs.writeFile(path.join(work, 'clip.mp4.chapters.json'), JSON.stringify(chapterManifest(20)))
    const root = await resolveSafeScanRoot(directory)

    await expect(
      collectLocalMedia(root, 'local/artist/work', limits, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'INPUT_SNAPSHOT_INVALID' })
  })
})

function chapterManifest(duration: number, count = 1) {
  const chapterDuration = duration / count
  return {
    version: 1,
    duration,
    chapters: Array.from({ length: count }, (_, index) => ({
      index: index + 1,
      title: `Chapter ${index + 1}`,
      start: index * chapterDuration,
      end: (index + 1) * chapterDuration,
      duration: chapterDuration
    }))
  }
}

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
