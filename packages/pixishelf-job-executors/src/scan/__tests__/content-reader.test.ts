import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readStableFileContent, stableFileStateFromMetadata } from '../content-reader.js'
import { computeLocalWorkContentFingerprint } from '../fingerprint.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('bounded stable content reads', () => {
  it('preserves filesystem identity signals above the safe JavaScript integer range', () => {
    const largeIdentity = 9_007_199_254_740_993n
    expect(
      stableFileStateFromMetadata({
        size: 10n,
        mtimeMs: 20n,
        ctimeMs: 30n,
        dev: largeIdentity,
        ino: largeIdentity + 1n
      })
    ).toEqual({
      sizeBytes: 10n,
      mtimeMs: 20n,
      ctimeMs: 30n,
      deviceId: largeIdentity,
      inode: largeIdentity + 1n
    })
  })

  it('returns bytes and the digest from the same bounded read', async () => {
    const root = await fixtureRoot()
    const file = path.join(root, 'metadata.json')
    const bytes = Buffer.from('{"id":42}')
    await fs.writeFile(file, bytes)

    const result = await readStableFileContent({
      absolutePath: await fs.realpath(file),
      maxBytes: bytes.length,
      signal: new AbortController().signal
    })

    expect(result.bytes).toEqual(bytes)
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    await expect(
      readStableFileContent({
        absolutePath: await fs.realpath(file),
        maxBytes: bytes.length - 1,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: 'INPUT_SNAPSHOT_INVALID' })
  })

  it('uses file content rather than mutable size/mtime metadata for local work fingerprints', async () => {
    const root = await fixtureRoot()
    const work = path.join(root, 'local-imports', 'Artist', 'Work')
    await fs.mkdir(work, { recursive: true })
    const media = path.join(work, '1.jpg')
    await fs.writeFile(media, 'AAAA')
    const originalStat = await fs.stat(media)
    const first = await fingerprint(root, 'local-imports/Artist/Work')

    await fs.writeFile(media, 'BBBB')
    await fs.utimes(media, originalStat.atime, originalStat.mtime)
    const second = await fingerprint(root, 'local-imports/Artist/Work')

    expect(first).not.toBe(second)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each(['clip.chapters.json', 'clip.mp4.chapters.json', 'clip..chapters.json'])(
    'includes compatible chapter sidecar %s without consuming the media file limit',
    async (manifestName) => {
      const root = await fixtureRoot()
      const work = path.join(root, 'local-imports', 'Artist', 'Work')
      await fs.mkdir(work, { recursive: true })
      await fs.writeFile(path.join(work, 'clip.mp4'), 'video')
      const manifest = path.join(work, manifestName)
      await fs.writeFile(manifest, 'AAAA')
      const originalStat = await fs.stat(manifest)
      const first = await fingerprint(root, 'local-imports/Artist/Work', 1)

      await fs.writeFile(manifest, 'BBBB')
      await fs.utimes(manifest, originalStat.atime, originalStat.mtime)
      const second = await fingerprint(root, 'local-imports/Artist/Work', 1)

      expect(first).not.toBe(second)
    }
  )
})

async function fingerprint(scanRoot: string, relativeDirectory: string, maxFiles = 10) {
  return computeLocalWorkContentFingerprint({
    scanRoot,
    relativeDirectory,
    kind: 'MEDIA_DIRECTORY',
    maxEntries: 10,
    maxFiles,
    maxFileBytes: 1024,
    signal: new AbortController().signal
  })
}

async function fixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-content-reader-'))
  roots.push(root)
  return root
}
