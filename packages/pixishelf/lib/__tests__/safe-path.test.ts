import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { assertSafeFileName, resolveCreatablePathWithinRoot, resolveExistingPathWithinRoot } from '../safe-path'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })))
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  temporaryPaths.push(directory)
  return directory
}

describe('safe path resolution', () => {
  it('accepts the root and ordinary descendants', async () => {
    const root = await temporaryDirectory('pixishelf-root-')
    const artistDirectory = path.join(root, 'artist')
    const newFile = path.join(artistDirectory, 'new.jpg')
    await mkdir(artistDirectory)

    await expect(resolveExistingPathWithinRoot(root, root)).resolves.toBe(await realpath(root))
    await expect(resolveCreatablePathWithinRoot(root, newFile)).resolves.toBe(newFile)
  })

  it('rejects traversal and sibling paths sharing the root prefix', async () => {
    const parent = await temporaryDirectory('pixishelf-parent-')
    const root = path.join(parent, 'data')
    const sibling = path.join(parent, 'data-other')
    await mkdir(root)
    await mkdir(sibling)

    await expect(resolveCreatablePathWithinRoot(root, path.join(root, '..', 'outside.jpg'))).rejects.toThrow(
      'Path escapes scan root'
    )
    await expect(resolveCreatablePathWithinRoot(root, path.join(sibling, 'outside.jpg'))).rejects.toThrow(
      'Path escapes scan root'
    )
  })

  it.each(['../outside.jpg', '..\\outside.jpg', 'nested/file.jpg', 'nested\\file.jpg', '.', '..', '/tmp/file.jpg'])(
    'rejects unsafe filename %s',
    (fileName) => {
      expect(() => assertSafeFileName(fileName)).toThrow('Invalid file name')
    }
  )

  it('accepts a single safe filename', () => {
    expect(assertSafeFileName('image 01.jpg')).toBe('image 01.jpg')
  })

  it('rejects an existing symlink that escapes the root', async () => {
    const root = await temporaryDirectory('pixishelf-root-')
    const outside = await temporaryDirectory('pixishelf-outside-')
    const link = path.join(root, 'escape')
    await writeFile(path.join(outside, 'secret.jpg'), 'secret')
    await symlink(outside, link, 'dir')

    await expect(resolveExistingPathWithinRoot(root, path.join(link, 'secret.jpg'))).rejects.toThrow(
      'Path escapes scan root'
    )
    await expect(resolveCreatablePathWithinRoot(root, path.join(link, 'new.jpg'))).rejects.toThrow(
      'Path escapes scan root'
    )
  })
})
