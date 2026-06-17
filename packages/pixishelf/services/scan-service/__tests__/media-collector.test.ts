import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectMediaFiles } from '../media-collector'

describe('collectMediaFiles', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-media-collector-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('collects paged media for local generated artwork ids', async () => {
    await fs.writeFile(path.join(tempDir, 'e_12418_8609575_p4.mp4'), 'video')
    await fs.writeFile(path.join(tempDir, 'e_12418_8609575_p4.chapters.json'), '{}')

    const result = await collectMediaFiles(tempDir, 'e_12418_8609575')

    expect(result.success).toBe(true)
    expect(result.mediaFiles).toHaveLength(1)
    expect(result.mediaFiles[0]).toMatchObject({
      filename: 'e_12418_8609575_p4.mp4',
      pageIndex: 4,
      sortOrder: 4
    })
  })
})
