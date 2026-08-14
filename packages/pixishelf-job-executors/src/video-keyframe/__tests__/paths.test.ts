import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveKeyframePath, resolveSourceFile } from '../paths.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('video keyframe path safety', () => {
  it('rejects lexical traversal outside source and derived-media roots', async () => {
    const root = await temporaryRoot()
    await expect(resolveSourceFile(root, '../outside.mp4')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_ALLOWED_ROOT'
    })
    await expect(resolveKeyframePath(root, '../outside.webp')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_ALLOWED_ROOT'
    })
  })

  it('rejects a source path that escapes through a directory symlink', async () => {
    const root = await temporaryRoot()
    const outside = await temporaryRoot()
    await writeFile(path.join(outside, 'video.mp4'), 'not-a-real-video')
    await symlink(outside, path.join(root, 'linked'), 'junction')

    await expect(resolveSourceFile(root, 'linked/video.mp4')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_ALLOWED_ROOT'
    })
  })

  it('rejects a derived-media output path that escapes through a directory symlink', async () => {
    const root = await temporaryRoot()
    const outside = await temporaryRoot()
    await symlink(outside, path.join(root, '1'), 'junction')

    await expect(resolveKeyframePath(root, '1/set-1/000.webp')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_ALLOWED_ROOT'
    })
  })
})

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-keyframe-path-'))
  roots.push(root)
  await mkdir(root, { recursive: true })
  return root
}
