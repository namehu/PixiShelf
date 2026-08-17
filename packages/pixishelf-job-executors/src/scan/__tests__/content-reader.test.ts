import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readStableFileContent } from '../content-reader.js'
import { computeLocalWorkContentFingerprint } from '../fingerprint.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('bounded stable content reads', () => {
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
})

async function fingerprint(scanRoot: string, relativeDirectory: string) {
  return computeLocalWorkContentFingerprint({
    scanRoot,
    relativeDirectory,
    kind: 'MEDIA_DIRECTORY',
    maxEntries: 10,
    maxFiles: 10,
    maxFileBytes: 1024,
    signal: new AbortController().signal
  })
}

async function fixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-content-reader-'))
  roots.push(root)
  return root
}
