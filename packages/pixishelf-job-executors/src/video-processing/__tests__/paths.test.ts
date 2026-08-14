import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveCreatablePathWithinRoot, resolveExistingPathWithinRoot } from '../paths.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('video processing final-component path safety', () => {
  it('rejects a source whose final path component is a symbolic link', async () => {
    const root = await createRoot()
    await fs.writeFile(path.join(root, 'real.mp4'), 'video')
    await fs.symlink(path.join(root, 'real.mp4'), path.join(root, 'source.mp4'), 'file')

    await expect(resolveExistingPathWithinRoot(root, 'source.mp4')).rejects.toThrow('Symbolic links')
  })

  it.each(['temporary.mp4', 'backup.mp4'])('rejects an existing %s artifact symlink', async (name) => {
    const root = await createRoot()
    await fs.writeFile(path.join(root, 'target.mp4'), 'artifact')
    await fs.symlink(path.join(root, 'target.mp4'), path.join(root, name), 'file')

    await expect(resolveCreatablePathWithinRoot(root, name)).rejects.toThrow('Symbolic links')
  })
})

async function createRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-video-path-'))
  roots.push(root)
  return root
}
