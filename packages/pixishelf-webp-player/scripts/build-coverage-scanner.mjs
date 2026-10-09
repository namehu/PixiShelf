#!/usr/bin/env node
// Produce a dependency-free scanner from the same gate as the player.
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

if (process.argv.length !== 3) throw new Error('Usage: node scripts/build-coverage-scanner.mjs OUTPUT.mjs')
const directory = dirname(fileURLToPath(import.meta.url))
let source = await readFile(resolve(directory, 'scan-coverage.mjs'), 'utf8')
source = source
  .replace("import { constants } from 'node:fs'", "import { constants, realpathSync } from 'node:fs'")
  .replace('pathToFileURL(resolve(process.argv[1])).href', 'pathToFileURL(realpathSync(process.argv[1])).href')
  .replace("import { build } from 'esbuild'", "import * as gate from '../src/independent-frame.ts'")
  .replace(/export async function loadGate\(\) \{[\s\S]*?\n\}/, 'export async function loadGate() { return gate }')
await build({
  stdin: { contents: source, resolveDir: directory, sourcefile: 'scan-coverage.mjs', loader: 'js' },
  outfile: resolve(process.argv[2]),
  platform: 'node',
  format: 'esm',
  bundle: true
})
