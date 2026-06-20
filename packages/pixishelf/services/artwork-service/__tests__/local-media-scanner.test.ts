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
        order: 0,
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
    expect(result.earliestMediaMtime).toEqual(expect.any(Date))
  })

  it('returns the earliest mtime from supported direct media files only', async () => {
    const targetRelDir = '/local/artwork'
    const targetDir = path.join(scanPath, targetRelDir)
    const nestedDir = path.join(targetDir, 'nested')
    await fs.mkdir(nestedDir, { recursive: true })

    const firstMediaPath = path.join(targetDir, '1.mp4')
    const secondMediaPath = path.join(targetDir, '2.mp4')
    const unsupportedPath = path.join(targetDir, 'notes.txt')
    const nestedMediaPath = path.join(nestedDir, '0.mp4')
    await Promise.all([
      fs.writeFile(firstMediaPath, 'first'),
      fs.writeFile(secondMediaPath, 'second'),
      fs.writeFile(unsupportedPath, 'unsupported'),
      fs.writeFile(nestedMediaPath, 'nested')
    ])

    const earliestDirectMediaMtime = new Date('2024-02-03T04:05:06.000Z')
    await fs.utimes(firstMediaPath, earliestDirectMediaMtime, earliestDirectMediaMtime)
    await fs.utimes(secondMediaPath, new Date('2024-03-03T04:05:06.000Z'), new Date('2024-03-03T04:05:06.000Z'))
    await fs.utimes(unsupportedPath, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'))
    await fs.utimes(nestedMediaPath, new Date('2021-01-01T00:00:00.000Z'), new Date('2021-01-01T00:00:00.000Z'))

    const result = await scanLocalArtworkMediaDirectory({
      scanPath,
      targetDirectoryRelativePath: targetRelDir
    })

    expect(result.earliestMediaMtime).toEqual(earliestDirectMediaMtime)
  })

  it('assigns dense order values after sorting filenames naturally', async () => {
    const fileNames = ['10.mp4', '2.mp4', '00261-2153324271.jpg', '00260-9.jpg']
    await Promise.all(fileNames.map((fileName) => fs.writeFile(path.join(scanPath, fileName), 'media')))

    const result = await scanLocalArtworkMediaDirectory({
      scanPath,
      targetDirectoryRelativePath: '/'
    })

    expect(result.filesMeta.map(({ fileName, order }) => ({ fileName, order }))).toEqual([
      { fileName: '2.mp4', order: 0 },
      { fileName: '10.mp4', order: 1 },
      { fileName: '00260-9.jpg', order: 2 },
      { fileName: '00261-2153324271.jpg', order: 3 }
    ])
  })

  it('cancels before scanning the directory', async () => {
    const checkCancelled = vi.fn().mockResolvedValue(true)

    await expect(
      scanLocalArtworkMediaDirectory({
        scanPath,
        targetDirectoryRelativePath: '/',
        checkCancelled
      })
    ).rejects.toThrow('Task cancelled')
    expect(checkCancelled).toHaveBeenCalled()
  })

  it('checks for cancellation during media processing', async () => {
    await fs.writeFile(path.join(scanPath, 'video.mp4'), 'video')
    const checkCancelled = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)

    await expect(
      scanLocalArtworkMediaDirectory({
        scanPath,
        targetDirectoryRelativePath: '/',
        checkCancelled
      })
    ).rejects.toThrow('Task cancelled')
    expect(checkCancelled).toHaveBeenCalledTimes(2)
  })

  it('stops assigning queued files and suppresses progress after concurrent cancellation', async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, index) => fs.writeFile(path.join(scanPath, `${index + 1}.mp4`), 'video'))
    )
    let cancellationChecks = 0
    const checkCancelled = vi.fn(async () => {
      cancellationChecks += 1
      return cancellationChecks === 2
    })
    const onProgress = vi.fn()

    await expect(
      scanLocalArtworkMediaDirectory({
        scanPath,
        targetDirectoryRelativePath: '/',
        checkCancelled,
        onProgress
      })
    ).rejects.toThrow('Task cancelled')

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onProgress).not.toHaveBeenCalled()
    expect(checkCancelled.mock.calls.length).toBeLessThanOrEqual(9)
  })
})
