import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

vi.mock('server-only', () => ({}))

import { scanLocalArtworkMediaDirectory } from '../local-media-scanner'

describe('scanLocalArtworkMediaDirectory', () => {
  let scanPath: string

  beforeEach(async () => {
    scanPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-local-media-scanner-'))
  })

  afterEach(async () => {
    await fs.rm(scanPath, { recursive: true, force: true })
  })

  it('builds media and chapter metadata for a local artwork directory', async () => {
    const targetRelDir = '/17332140/e_75_9050506'
    const targetDir = path.join(scanPath, targetRelDir)
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(path.join(targetDir, 'e_75_9050506_1.mp4'), 'video')
    await fs.writeFile(
      path.join(targetDir, 'e_75_9050506_1.chapters.json'),
      JSON.stringify({
        version: 1,
        duration: 10,
        chapters: [{ index: 1, title: 'Intro', start: 0, end: 10, duration: 10 }]
      })
    )

    const result = await scanLocalArtworkMediaDirectory({
      scanPath,
      targetDirectoryRelativePath: targetRelDir
    })

    expect(result.warnings).toEqual([])
    expect(result.filesMeta).toEqual([
      {
        fileName: 'e_75_9050506_1.mp4',
        order: 1,
        width: 0,
        height: 0,
        size: 5,
        path: '/17332140/e_75_9050506/e_75_9050506_1.mp4'
      }
    ])
    expect(result.chaptersMeta).toMatchObject([
      {
        videoFileName: 'e_75_9050506_1.mp4',
        chaptersFileName: 'e_75_9050506_1.chapters.json',
        chaptersPath: '/17332140/e_75_9050506/e_75_9050506_1.chapters.json',
        chaptersCount: 1,
        chaptersDuration: 10
      }
    ])
    expect(result.chaptersMeta[0]?.chaptersHash).toEqual(expect.any(String))
  })
})
