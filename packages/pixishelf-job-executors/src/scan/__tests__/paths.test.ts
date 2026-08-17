import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSafeExistingPath, resolveSafeScanRoot, walkSafeFiles } from '../paths.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('scan path safety', () => {
  it('streams bounded pages without returning absolute paths as checkpoint data', async () => {
    const directory = await fixtureRoot()
    await fs.mkdir(path.join(directory, 'artist'), { recursive: true })
    for (let index = 1; index <= 5; index += 1) {
      await fs.writeFile(path.join(directory, 'artist', `${index}-meta.json`), '{}')
    }
    const root = await resolveSafeScanRoot(directory)
    const pages: string[][] = []
    for await (const page of walkSafeFiles(root, '', {
      pageSize: 2,
      maxDepth: 4,
      maxEntries: 20,
      signal: new AbortController().signal,
      include: (relativePath) => relativePath.endsWith('.json')
    })) {
      pages.push(page.map((item) => item.relativePath))
    }
    expect(pages.map((page) => page.length)).toEqual([2, 2, 1])
    expect(pages.flat()).toEqual([
      'artist/1-meta.json',
      'artist/2-meta.json',
      'artist/3-meta.json',
      'artist/4-meta.json',
      'artist/5-meta.json'
    ])
  })

  it('rejects traversal, absolute paths, and symbolic links', async () => {
    const directory = await fixtureRoot()
    await fs.mkdir(path.join(directory, 'safe'), { recursive: true })
    await fs.writeFile(path.join(directory, 'safe', '1-meta.json'), '{}')
    const root = await resolveSafeScanRoot(directory)
    await expect(resolveSafeExistingPath(root, '../outside.json', 'file')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_SCAN_ROOT'
    })
    await expect(
      resolveSafeExistingPath(root, path.resolve(directory, 'safe', '1-meta.json'), 'file')
    ).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_SCAN_ROOT'
    })

    const link = path.join(directory, 'unsafe-link')
    try {
      await fs.symlink(path.join(directory, 'safe'), link, 'junction')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }
    await expect(resolveSafeExistingPath(root, 'unsafe-link/1-meta.json', 'file')).rejects.toMatchObject({
      code: 'SYMLINK_NOT_ALLOWED'
    })
  })
})

async function fixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-scan-paths-'))
  roots.push(root)
  return root
}
