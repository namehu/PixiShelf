import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** The caller owns the surrounding file lock and has resolved the managed parent directory. */
export async function writeRecoveryManifest(filePath: string, value: unknown) {
  const temporary = `${filePath}.${randomUUID()}.tmp`
  const handle = await fs.open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(value))
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(temporary, filePath)
  const directory = await fs.open(path.dirname(filePath), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}
