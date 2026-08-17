import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverBoundedLocalWorkCandidates } from '../control-plane-discovery.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('discoverBoundedLocalWorkCandidates', () => {
  it('fails deterministically when the candidate bound is exceeded', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-bounded-local-'))
    roots.push(root)
    await fs.mkdir(path.join(root, 'local-imports', 'artist', 'one'), { recursive: true })
    await fs.mkdir(path.join(root, 'local-imports', 'artist', 'two'), { recursive: true })
    await fs.writeFile(path.join(root, 'local-imports', 'artist', 'one', 'a.jpg'), 'one')
    await fs.writeFile(path.join(root, 'local-imports', 'artist', 'two', 'b.jpg'), 'two')

    await expect(
      discoverBoundedLocalWorkCandidates({
        scanRoot: root,
        localDirectory: 'local-imports',
        limits: {
          pageSize: 10,
          maxDepth: 3,
          maxEntries: 20,
          maxMediaPerArtwork: 10,
          maxCandidates: 1
        },
        signal: new AbortController().signal
      })
    ).rejects.toThrow('candidate count exceeds the configured limit')
  })
})
