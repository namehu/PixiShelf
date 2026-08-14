import { spawn } from 'node:child_process'
import type { VideoProcessRunner } from './types.js'
import { VideoProcessingProcessError } from './types.js'

const MAX_PROCESS_OUTPUT_BYTES = 10 * 1024 * 1024

export const runVideoProcess: VideoProcessRunner = (request) =>
  new Promise((resolve, reject) => {
    throwIfAborted(request.signal)
    const child = spawn(request.command, [...request.args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    let terminationError: Error | undefined

    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString()}`.slice(-MAX_PROCESS_OUTPUT_BYTES)
    child.stdout.on('data', (chunk: Buffer) => {
      const value = chunk.toString()
      stdout = append(stdout, chunk)
      request.onStdout?.(value)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk)
    })

    const cleanup = () => {
      clearTimeout(timeout)
      request.signal.removeEventListener('abort', onAbort)
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve({ stdout, stderr })
    }
    const terminate = (error: Error) => {
      if (settled || terminationError) return
      terminationError = error
      // Do not synthesize completion after kill. The caller must not release its
      // lease or touch artifacts until the OS confirms every stdio handle is closed.
      if (!child.killed) child.kill('SIGKILL')
    }
    const onAbort = () => terminate(abortReason(request.signal))
    const timeout = setTimeout(
      () =>
        terminate(
          new VideoProcessingProcessError(
            'EXTERNAL_PROCESS_TIMEOUT',
            `${request.command} exceeded ${request.timeoutMs}ms`
          )
        ),
      request.timeoutMs
    )
    timeout.unref()
    request.signal.addEventListener('abort', onAbort, { once: true })
    child.once('error', (error) => terminate(new VideoProcessingProcessError('EXTERNAL_PROCESS_FAILED', error.message)))
    child.once('close', (code) => {
      if (terminationError) finish(terminationError)
      else if (code === 0) finish()
      else {
        finish(
          new VideoProcessingProcessError(
            'EXTERNAL_PROCESS_FAILED',
            stderr.trim() || `${request.command} exited with code ${code}`
          )
        )
      }
    })
  })

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal)
}

export function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Video processing was interrupted')
}
