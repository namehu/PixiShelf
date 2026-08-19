import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, mkdir, open, opendir, readFile, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import type { PendingReplaceFileSystemPort } from './types.ts'

export function createNodePendingReplaceFileSystem(): PendingReplaceFileSystemPort {
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
      if (!Number.isInteger(limit) || limit < 1) throw new Error('Directory entry limit must be positive')
      const entries = []
      const directory = await opendir(directoryPath)
      try {
        for await (const entry of directory) {
          if (entries.length === limit) return { entries, hasMore: true }
          entries.push({
            name: entry.name,
            isFile: entry.isFile(),
            isDirectory: entry.isDirectory(),
            isSymbolicLink: entry.isSymbolicLink()
          })
        }
      } finally {
        await directory.close().catch(() => undefined)
      }
      return { entries, hasMore: false }
    },
    async mkdir(directoryPath) {
      await mkdir(directoryPath, { recursive: true })
    },
    rename,
    async hashFile(filePath) {
      const hash = createHash('sha256')
      const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 })
      for await (const chunk of stream) hash.update(chunk)
      return hash.digest('hex')
    },
    async writeFileExclusive(filePath, contents) {
      await writeFile(filePath, contents, { encoding: 'utf8', flag: 'wx' })
      const handle = await open(filePath, 'r+')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    },
    async readFileBounded(filePath, maximumBytes) {
      const stat = await lstat(filePath)
      if (!stat.isFile() || stat.size > maximumBytes) throw new Error('File exceeds bounded read limit')
      return readFile(filePath, 'utf8')
    },
    unlink,
    async removeDirectoryIfEmpty(directoryPath) {
      try {
        await rmdir(directoryPath)
      } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      }
    }
  }
}
