import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { build } from 'esbuild'
import { expect, it } from 'vitest'
import { DedupReaderSupervisor } from '../../../pixishelf-job-executors/src/artwork-dedup/reader.ts'

it('runs the fixed reader entry after the same CJS transform as production Worker', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-bundle-')))
  const entrypoint = path.join(root, 'reader.cjs')
  await build({
    entryPoints: [path.resolve('../pixishelf-job-executors/src/artwork-dedup/reader-child.ts')],
    outfile: entrypoint,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    logLevel: 'silent'
  })
  const reader = new DedupReaderSupervisor({ entrypoint }).create()
  try {
    await fs.writeFile(path.join(root, 'sample'), 'original')
    await reader.start()
    const signal = new AbortController().signal
    const roots = await reader.resolveRoots(
      { operation: 'roots', sourceRoot: root, archiveRoot: root, expectedPixivRootIdentity: null },
      signal
    )
    const file = await reader.read({ root: roots.source, relativePath: 'sample', signal })
    expect(file.bytesRead).toBe(8n)
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
  } finally {
    await reader.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})
