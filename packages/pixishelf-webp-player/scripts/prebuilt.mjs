import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const packageRoot = new URL('../', import.meta.url)
export const artifactFiles = ['decoder.mjs', 'decoder.wasm', 'libwebp-license.txt', 'libwebp-patents.txt']
export const buildInputs = [
  'native/toolchain.json',
  'native/build.sh',
  'native/stream-decoder.c',
  'scripts/build-native.mjs'
]
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
export async function readToolchain(root = packageRoot) {
  return JSON.parse(await readFile(new URL('native/toolchain.json', root), 'utf8'))
}
export async function sourceHashes(root = packageRoot) {
  return Object.fromEntries(
    await Promise.all(
      buildInputs.map(async (file) => [
        file,
        sha256((await readFile(new URL(file, root), 'utf8')).replace(/\r\n/g, '\n'))
      ])
    )
  )
}
export async function artifactHashes(directory) {
  return Object.fromEntries(
    await Promise.all(artifactFiles.map(async (file) => [file, sha256(await readFile(new URL(file, directory)))]))
  )
}
export async function verifyPrebuilt(root = packageRoot) {
  const toolchain = await readToolchain(root)
  const directory = new URL(`prebuilt/libwebp-${toolchain.libwebp}/`, root)
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'))
  const reject = (detail) => {
    throw new Error(
      `WebP prebuilt verification failed (${detail}). Run pnpm --filter @pixishelf/webp-player build:native and commit the prebuilt artifacts.`
    )
  }
  if (manifest.schemaVersion !== 1 || JSON.stringify(manifest.toolchain) !== JSON.stringify(toolchain))
    reject('toolchain')
  for (const [file, hash] of Object.entries(await sourceHashes(root))) {
    if (manifest.inputs?.[file] !== hash) reject(`stale source: ${file}`)
  }
  for (const [file, hash] of Object.entries(await artifactHashes(directory))) {
    if (manifest.artifacts?.[file] !== hash) reject(`artifact: ${file}`)
  }
  if (!WebAssembly.validate(await readFile(new URL('decoder.wasm', directory)))) reject('invalid WASM')
  return { directory, toolchain }
}
