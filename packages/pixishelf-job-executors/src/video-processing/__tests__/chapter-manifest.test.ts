import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createChapterManifestHash, readChapterManifest } from '../chapter-manifest.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('chapter manifest compatibility', () => {
  it('normalizes the same declared fields and key order used by the existing manifest contract', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-manifest-'))
    roots.push(root)
    const input = {
      customRoot: 'preserved',
      chapters: [{ customChapter: 7, duration: 4, end: 4, start: 0, index: 1, title: '  Opening  ', file: 'one.mp4' }],
      generatedAt: '2026-08-14T00:00:00.000Z',
      duration: 4,
      version: 2
    }
    await fs.writeFile(path.join(root, 'video.chapters.json'), JSON.stringify(input))

    const parsed = await readChapterManifest(root, 'video.chapters.json')
    const expected = {
      version: 2,
      duration: 4,
      generatedAt: '2026-08-14T00:00:00.000Z',
      chapters: [
        {
          index: 1,
          title: 'Opening',
          start: 0,
          end: 4,
          duration: 4,
          file: 'one.mp4',
          customChapter: 7
        }
      ],
      customRoot: 'preserved'
    }
    expect(parsed).toEqual(expected)
    expect(createChapterManifestHash(parsed)).toBe(createHash('sha256').update(JSON.stringify(expected)).digest('hex'))
  })

  it('rejects manifests above the bounded chapter limit', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-manifest-'))
    roots.push(root)
    const chapters = Array.from({ length: 1_001 }, (_, index) => ({
      index: index + 1,
      title: `Chapter ${index + 1}`,
      start: index,
      end: index + 1,
      duration: 1
    }))
    await fs.writeFile(
      path.join(root, 'oversized.chapters.json'),
      JSON.stringify({ version: 1, duration: chapters.length, chapters })
    )

    await expect(readChapterManifest(root, 'oversized.chapters.json')).rejects.toMatchObject({
      code: 'INVALID_CHAPTER_MANIFEST'
    })
  })
})
