import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { buildInputs, packageRoot, readToolchain, verifyPrebuilt } from '../scripts/prebuilt.mjs'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'pixishelf-webp-prebuilt-'))
  // The cleanup target is exactly the directory returned by mkdtemp.
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = pathToFileURL(directory + '/')
  for (const file of buildInputs) {
    await mkdir(dirname(fileURLToPath(new URL(file, root))), { recursive: true })
    await cp(new URL(file, packageRoot), new URL(file, root))
  }
  await cp(new URL('prebuilt/', packageRoot), new URL('prebuilt/', root), { recursive: true })
  const { libwebp } = await readToolchain(root)
  return { root, output: new URL(`prebuilt/libwebp-${libwebp}/`, root) }
}

test('validates checked-in artifacts without native build output', async () => {
  await verifyPrebuilt()
})
test('rejects a changed WASM byte', async (t) => {
  const { root, output } = await fixture(t)
  const file = new URL('decoder.wasm', output),
    bytes = await readFile(file)
  bytes[bytes.length - 1] ^= 1
  await writeFile(file, bytes)
  await assert.rejects(verifyPrebuilt(root), /artifact: decoder.wasm/)
})
test('rejects native source drift', async (t) => {
  const { root } = await fixture(t)
  const file = new URL('native/stream-decoder.c', root)
  await writeFile(file, (await readFile(file, 'utf8')) + '\n/* changed */\n')
  await assert.rejects(verifyPrebuilt(root), /stale source/)
})
test('accepts platform line-ending changes in source, without rewriting artifacts', async (t) => {
  const { root } = await fixture(t)
  for (const input of buildInputs) {
    const file = new URL(input, root)
    await writeFile(file, (await readFile(file, 'utf8')).replace(/\r?\n/g, '\r\n'))
  }
  await verifyPrebuilt(root)
})
test('rejects missing licenses and toolchain drift', async (t) => {
  const { root, output } = await fixture(t)
  const file = new URL('native/toolchain.json', root)
  const original = await readFile(file, 'utf8')
  await writeFile(file, JSON.stringify({ ...JSON.parse(original), emscripten: 'different' }))
  await assert.rejects(verifyPrebuilt(root), /toolchain/)
  await writeFile(file, original)
  await rm(new URL('libwebp-license.txt', output))
  await assert.rejects(verifyPrebuilt(root), /ENOENT/)
})
