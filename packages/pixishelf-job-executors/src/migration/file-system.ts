import { createReadStream, constants as fsConstants } from 'node:fs'
import { copyFile, lstat, mkdir, open, opendir, realpath, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { MigrationFileSystemPort } from './types.ts'

export function createNodeMigrationFileSystem(): MigrationFileSystemPort {
  return {
    async lstat(filePath) {
      const stat = await lstat(filePath)
      return {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        isSymbolicLink: stat.isSymbolicLink(),
        identity: `${stat.dev}:${stat.ino}`
      }
    },
    realpath,
    async listDirectoryBounded(directoryPath, limit) {
      if (!Number.isInteger(limit) || limit < 1) throw new Error('Directory listing limit must be a positive integer')
      const names: string[] = []
      const directory = await opendir(directoryPath)
      try {
        for await (const entry of directory) {
          if (names.length === limit) return { names, hasMore: true }
          names.push(entry.name)
        }
      } finally {
        await directory.close().catch(() => undefined)
      }
      return { names, hasMore: false }
    },
    async mkdir(directoryPath) {
      await mkdir(directoryPath)
    },
    async copyFileExclusive(sourcePath, targetPath) {
      await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL)
    },
    hashFile,
    async syncFile(filePath) {
      const handle = await open(filePath, 'r')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    },
    async syncDirectory(directoryPath) {
      let handle
      try {
        handle = await open(directoryPath, 'r')
        await handle.sync()
      } catch (error) {
        // Windows does not support fsync on directory handles. File fsync plus the exclusive
        // copy still provides the strongest durability available there.
        if (process.platform !== 'win32') throw error
      } finally {
        await handle?.close()
      }
    },
    unlink
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}
