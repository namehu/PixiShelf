import { createRequire } from 'node:module'
import path from 'node:path'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import type { IsolatedDurationProbe as ProbeType } from '../../../pixishelf-job-executors/src/maintenance/animation-duration-child.ts'

describe('bundled duration probe child source', () => {
  it('runs the parser after the Worker esbuild transform', async () => {
    const output = await build({
      entryPoints: [path.resolve(process.cwd(), '../pixishelf-job-executors/src/maintenance/animation-duration-child.ts')],
      bundle: true,
      write: false,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      logLevel: 'silent'
    })
    const bundled = { exports: {} as { IsolatedDurationProbe?: typeof ProbeType } }
    const evaluate = new Function('require', 'module', 'exports', output.outputFiles[0]!.text)
    evaluate(createRequire(import.meta.url), bundled, bundled.exports)
    const Probe = bundled.exports.IsolatedDurationProbe
    expect(Probe).toBeDefined()
    const fixture = path.resolve(process.cwd(), '../pixishelf-webp-player/tests/fixtures/short.webp')
    const probe = new Probe!({ timeoutMs: 5_000 })
    try {
      const result = await probe.probe(path.dirname(fixture), path.basename(fixture), new AbortController().signal)
      expect(result.probe).toMatchObject({ status: 'READY', format: 'WEBP' })
      expect(result.probe.durationMs).toBeGreaterThan(0)
    } finally {
      await probe.close()
    }
  })
})
