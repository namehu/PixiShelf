import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { build } from 'esbuild'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { DedupReaderSupervisor } from '../../../pixishelf-job-executors/src/artwork-dedup/reader.ts'

it('runs the fixed reader entry after the same CJS transform as production Worker', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-bundle-')))
  const entrypoint = path.join(root, 'reader.cjs')
  const reader = new DedupReaderSupervisor({ entrypoint }).create()
  try {
    await fs.symlink(path.resolve('node_modules'), path.join(root, 'node_modules'), 'dir')
    await build({
      entryPoints: [path.resolve('../pixishelf-job-executors/src/artwork-dedup/reader-child.ts')],
      outfile: entrypoint,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      external: ['@prisma/client', '.prisma/client', 'sharp'],
      logLevel: 'silent'
    })
    await fs.writeFile(path.join(root, 'sample'), 'original')
    const image = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#2468ac' } })
      .png()
      .toBuffer()
    await fs.writeFile(path.join(root, 'sample.png'), image)
    await reader.start()
    const signal = new AbortController().signal
    const roots = await reader.resolveRoots(
      { operation: 'roots', sourceRoot: root, archiveRoot: root, expectedPixivRootIdentity: null },
      signal
    )
    const file = await reader.read({ root: roots.source, relativePath: 'sample', signal })
    expect(file.bytesRead).toBe(8n)
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
    const visual = await reader.visual({ root: roots.source, relativePath: 'sample.png', signal })
    expect(visual.bytesRead).toBe(BigInt(image.length))
    expect(visual.views[0]).toMatchObject({ name: 'original', feature: { width: 48, height: 32 } })
    expect(visual.views[0]?.feature.hashes).toHaveLength(10)
  } finally {
    try {
      await reader.close()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }
})
