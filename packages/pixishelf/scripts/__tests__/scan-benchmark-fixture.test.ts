import { mkdtemp, readdir, readFile, rm, stat } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupBenchmarkFixture, generateBenchmarkFixture, parseBenchmarkArgs } from '../scan-benchmark-fixture'

const tempRoots: string[] = []

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-benchmark-test-'))
  tempRoots.push(root)
  return root
}

describe('scan benchmark fixture script', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('parses benchmark arguments with safe defaults and explicit overrides', () => {
    expect(parseBenchmarkArgs([])).toMatchObject({
      count: 100,
      pages: 1,
      depth: 2,
      keep: false
    })

    expect(parseBenchmarkArgs(['--count', '250', '--pages', '3', '--depth', '4', '--keep'])).toMatchObject({
      count: 250,
      pages: 3,
      depth: 4,
      keep: true
    })

    expect(parseBenchmarkArgs(['--', '--count', '2'])).toMatchObject({
      count: 2
    })
  })

  it('rejects invalid benchmark arguments before creating a large fixture', () => {
    expect(() => parseBenchmarkArgs(['--count', '0'])).toThrow('count must be between 1 and 100000')
    expect(() => parseBenchmarkArgs(['--pages', '0'])).toThrow('pages must be between 1 and 100')
    expect(() => parseBenchmarkArgs(['--depth', '5'])).toThrow('depth must be between 1 and 4')
  })

  it('generates Pixiv-style metadata and media files in a temporary scan root', async () => {
    const baseDir = await createTempRoot()
    const result = await generateBenchmarkFixture({
      baseDir,
      count: 3,
      pages: 2,
      depth: 2
    })

    expect(result.artworks).toBe(3)
    expect(result.mediaFiles).toBe(6)
    expect(result.metadataFiles).toBe(3)
    expect(result.scanPath.startsWith(baseDir)).toBe(true)
    expect(result.durationMs).toEqual(expect.any(Number))

    const firstArtworkDir = path.join(result.scanPath, 'bucket-000', 'artist-000')
    const entries = await readdir(firstArtworkDir)
    expect(entries).toEqual(expect.arrayContaining(['900000000-meta.json', '900000000_p0.jpg', '900000000_p1.jpg']))

    const metadata = JSON.parse(await readFile(path.join(firstArtworkDir, '900000000-meta.json'), 'utf-8'))
    expect(metadata).toMatchObject({
      id: 900000000,
      user: 'Benchmark Artist 000',
      userId: '700000',
      title: 'Benchmark Artwork 000000',
      tags: ['benchmark', 'bucket-000', 'page-count-2']
    })
  })

  it('cleans up generated benchmark fixtures unless keep mode is requested', async () => {
    const baseDir = await createTempRoot()
    const result = await generateBenchmarkFixture({
      baseDir,
      count: 1,
      pages: 1,
      depth: 1
    })

    await expect(stat(result.scanPath)).resolves.toBeTruthy()
    await cleanupBenchmarkFixture(result.scanPath, { keep: false })
    await expect(stat(result.scanPath)).rejects.toMatchObject({ code: 'ENOENT' })

    const kept = await generateBenchmarkFixture({
      baseDir,
      count: 1,
      pages: 1,
      depth: 1
    })

    await cleanupBenchmarkFixture(kept.scanPath, { keep: true })
    await expect(stat(kept.scanPath)).resolves.toBeTruthy()
  })
})
