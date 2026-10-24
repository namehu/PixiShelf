import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
export function buildDedupNative(output = path.join(root, 'dist/artwork-dedup-native.node')) {
  // Other Worker features remain available; the reader refuses file maintenance there.
  if (!['linux', 'darwin'].includes(process.platform)) return null
  mkdirSync(path.dirname(output), { recursive: true })
  const include = path.resolve(path.dirname(process.execPath), '../include/node')
  const platform = process.platform === 'darwin' ? ['-bundle', '-undefined', 'dynamic_lookup'] : ['-shared', '-fPIC']
  const result = spawnSync(
    'cc',
    [
      '-std=c11',
      '-O2',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-DNAPI_VERSION=8',
      '-I',
      include,
      ...platform,
      path.join(root, 'native/artwork-dedup-rename.c'),
      '-o',
      output
    ],
    { stdio: 'inherit' }
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Dedup native compilation failed (${result.status})`)
  return output
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildDedupNative()
