import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { artifactFiles, artifactHashes, packageRoot, readToolchain, sourceHashes, verifyPrebuilt } from './prebuilt.mjs'

const root = fileURLToPath(packageRoot)
const toolchain = await readToolchain()
const inputs = await sourceHashes()
const check = process.argv.includes('--check')
// Keep generated files writable by the host runner on Linux CI.
const user = process.getuid && process.getgid ? ['--user', `${process.getuid()}:${process.getgid()}`] : []
if (check) await verifyPrebuilt()
for (const script of ['build.sh', 'check.sh']) {
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      ...user,
      '--mount',
      `type=bind,source=${root},target=/work`,
      '-e',
      `LIBWEBP_VERSION=${toolchain.libwebp}`,
      '-e',
      `LIBWEBP_SHA256=${toolchain.sourceSha256}`,
      toolchain.image,
      'sh',
      `/work/native/${script}`
    ],
    { stdio: 'inherit', windowsHide: true }
  )
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
if (JSON.stringify(inputs) !== JSON.stringify(await sourceHashes()))
  throw new Error('Native source changed during build')
const compiled = new URL('dist/native/', packageRoot)
const output = new URL(`prebuilt/libwebp-${toolchain.libwebp}/`, packageRoot)
const artifacts = await artifactHashes(compiled)
if (check) {
  const committed = await artifactHashes(output)
  for (const file of artifactFiles) {
    if (artifacts[file] !== committed[file]) throw new Error(`Non-reproducible prebuilt: ${file}`)
  }
  console.log('Native rebuild matches prebuilt artifacts')
} else {
  await mkdir(output, { recursive: true })
  for (const file of artifactFiles) await copyFile(new URL(file, compiled), new URL(file, output))
  await writeFile(
    new URL('manifest.json', output),
    JSON.stringify({ schemaVersion: 1, toolchain, inputs, artifacts }, null, 2) + '\n'
  )
  await verifyPrebuilt()
  console.log('Verified native artifacts saved to prebuilt; include them in the source change')
}
