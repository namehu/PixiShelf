import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectGcCandidate, resolveVideoSource } from '../paths.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('video media path safety', () => {
  it('rejects a video source that escapes through a directory symlink', async () => {
    const root = await temporaryDirectory('video-media-root-')
    const outside = await temporaryDirectory('video-media-outside-')
    await writeFile(path.join(outside, 'escape.mp4'), 'video')
    await symlink(outside, path.join(root, 'linked'), 'junction')

    await expect(resolveVideoSource(root, 'linked/escape.mp4')).rejects.toThrow('outside the configured media root')
  })

  it('refuses to delete a GC candidate that is itself a symlink', async () => {
    const root = await temporaryDirectory('video-poster-root-')
    const outside = await temporaryDirectory('video-poster-outside-')
    const target = path.join(outside, 'target.webp')
    await writeFile(target, 'poster')
    await symlink(target, path.join(root, '1-linked.webp'), 'file')

    await expect(inspectGcCandidate(root, '1-linked.webp')).rejects.toThrow(/symbolic link|outside the configured media root/)
  })
})

async function temporaryDirectory(prefix: string) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(directory)
  await mkdir(directory, { recursive: true })
  return directory
}
