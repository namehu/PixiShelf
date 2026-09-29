import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { verifyPrebuilt, artifactFiles } from './prebuilt.mjs'
const { directory: prebuilt, toolchain } = await verifyPrebuilt()
const root = fileURLToPath(new URL('../', import.meta.url))
process.chdir(root)
await mkdir('dist/assets', { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: ['src/worker.ts'],
  outfile: 'dist/assets/worker.mjs',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022'
})
await build({
  absWorkingDir: root,
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022'
})
for (const name of artifactFiles) {
  await copyFile(new URL(name, prebuilt), `dist/assets/${name}`)
}
const hash = createHash('sha256')
for (const file of ['worker.mjs', 'decoder.mjs', 'decoder.wasm']) hash.update(await readFile(`dist/assets/${file}`))
await writeFile(
  'dist/manifest.json',
  JSON.stringify(
    { version: hash.digest('hex').slice(0, 16), libwebp: toolchain.libwebp, emscripten: toolchain.emscripten },
    null,
    2
  ) + '\n'
)
