import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createNodePendingReplaceFileSystem } from '../file-system.js'
import { caseFoldPath, normalizeStoredRelativePath, resolveSafeExistingPath } from '../paths.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('pending replacement safe paths', () => {
  it('rejects traversal and treats case-only paths as the same checkpoint', () => {
    expect(() => normalizeStoredRelativePath('../outside')).toThrow('unsafe segment')
    expect(normalizeStoredRelativePath('a//b')).toBe('a/b')
    expect(caseFoldPath('Pending-Replaces/A')).toBe(caseFoldPath('pending-replaces/a'))
  })

  it('rejects a symlink or junction in any existing path segment', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-pending-path-'))
    roots.push(root)
    const outside = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-pending-outside-'))
    roots.push(outside)
    await mkdir(path.join(root, 'pending-replaces'))
    await writeFile(path.join(outside, 'secret.jpg'), 'secret')
    await symlink(
      outside,
      path.join(root, 'pending-replaces', 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    await expect(
      resolveSafeExistingPath(createNodePendingReplaceFileSystem(), root, 'pending-replaces/linked/secret.jpg', 'file')
    ).rejects.toThrow('links are not allowed')
  })
})
