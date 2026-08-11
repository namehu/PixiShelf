import fs from 'fs/promises'
import { createReadStream } from 'fs'
import { createHash } from 'crypto'
import path from 'path'

export async function assertDirectoryAbsent(directory: string, message: string) {
  if (await pathExists(directory)) throw new Error(message)
}

export async function assertDirectoryEmptyOrAbsent(directory: string, message: string) {
  if (!(await pathExists(directory))) return
  if ((await fs.readdir(directory)).length > 0) throw new Error(message)
}

export async function assertFileAbsent(file: string, message: string) {
  if (await pathExists(file)) throw new Error(message)
}

export async function pathExists(candidate: string) {
  try {
    await fs.lstat(candidate)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function moveIfExists(source: string, destination: string) {
  if (!(await pathExists(source))) return
  await assertFileAbsent(destination, `目标位置已存在同名文件: ${destination}`)
  await fs.rename(source, destination)
}

export async function removeEmptyDirectory(directory: string) {
  try {
    if ((await fs.readdir(directory)).length === 0) await fs.rmdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function directorySize(directory: string) {
  let total = 0
  try {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isFile()) total += (await fs.stat(path.join(directory, entry.name))).size
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return total
}

export function createFileSha256(file: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
