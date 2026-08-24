import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import type { WorkerConfig } from './config.js'

export type PathAccess = 'read' | 'read-write'

export interface PreflightDependencies {
  checkDatabaseSchema(): Promise<void>
  checkPath(path: string, access: PathAccess): Promise<void>
  checkExecutable(path: string, timeoutMs: number, signal?: AbortSignal): Promise<void>
}

async function defaultCheckPath(path: string, requiredAccess: PathAccess) {
  const metadata = await stat(path)
  if (!metadata.isDirectory()) throw new Error(`Preflight path is not a directory: ${path}`)
  const mode = requiredAccess === 'read-write' ? constants.R_OK | constants.W_OK : constants.R_OK
  await access(path, mode)
}

function defaultCheckExecutable(path: string, timeoutMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    execFile(path, ['-version'], { timeout: timeoutMs, signal, windowsHide: true, maxBuffer: 256 * 1_024 }, (error) =>
      error ? reject(new Error(`Executable preflight failed for ${path}: ${error.message}`)) : resolve()
    )
  })
}

export const defaultPreflightDependencies: Omit<PreflightDependencies, 'checkDatabaseSchema'> = {
  checkPath: defaultCheckPath,
  checkExecutable: defaultCheckExecutable
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Worker preflight aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('Worker preflight aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export async function runStartupPreflight(
  config: WorkerConfig,
  dependencies: PreflightDependencies,
  signal?: AbortSignal
) {
  await abortable(dependencies.checkDatabaseSchema(), signal)
  await Promise.all([
    abortable(dependencies.checkPath(config.sourceMediaRoot, 'read-write'), signal),
    abortable(dependencies.checkPath(config.derivedMediaRoot, 'read-write'), signal),
    // App 只读同一挂载，Worker 必须在启动前确认拥有写权限以保证封面原子落盘。
    abortable(dependencies.checkPath(config.pixivDataRoot, 'read-write'), signal),
    abortable(dependencies.checkPath(config.archiveRoot, 'read-write'), signal),
    abortable(dependencies.checkExecutable(config.ffmpegPath, config.preflightTimeoutMs, signal), signal),
    abortable(dependencies.checkExecutable(config.ffprobePath, config.preflightTimeoutMs, signal), signal)
  ])
}
