import { mkdir, rm, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const DEFAULT_WAIT_MS = 10 * 60_000
const POLL_MS = 100
const LOCK_NAME = '.replace-write-lock'

/** A stale lock is never stolen automatically while NFS I/O may still be active. */
export class ReplaceWriteBusyError extends Error {
  readonly code = 'REPLACE_WRITE_LOCK_BUSY'
}

export async function withReplaceWriteLock<T>(
  targetDir: string,
  action: () => Promise<T>,
  options: { waitMs?: number; isCancelled?: () => boolean } = {}
): Promise<T> {
  const lockDir = path.join(targetDir, LOCK_NAME)
  const deadline = Date.now() + (options.waitMs ?? DEFAULT_WAIT_MS)
  while (true) {
    if (options.isCancelled?.()) throw new ReplaceWriteBusyError('Media upload was cancelled while waiting for the write lock')
    try {
      await mkdir(lockDir)
      break
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      if (Date.now() >= deadline) {
        throw new ReplaceWriteBusyError(`Media write lock remained busy: ${lockDir}. Stop every App instance and inspect the media and backup before removing this single lock directory.`)
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
  }
  try {
    await writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({
      pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString()
    }), { flag: 'wx' })
    if (options.isCancelled?.()) throw new ReplaceWriteBusyError('Media upload was cancelled while waiting for the write lock')
    return await action()
  } finally {
    await rm(path.join(lockDir, 'owner.json'), { force: true })
    await rmdir(lockDir)
  }
}
