import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorMessage } from '@pixishelf/job-runtime'
import { defaultPreflightDependencies } from '../preflight.js'
import { createJsonLogger } from '../logger.js'

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile }))

afterEach(() => {
  vi.restoreAllMocks()
  execFile.mockReset()
})

describe('executable preflight diagnostics', () => {
  it.each([
    { code: 1, signal: null, killed: false },
    { code: null, signal: 'SIGTERM', killed: true },
    { code: 'ENOENT', signal: undefined, killed: undefined }
  ])('preserves child evidence through the production logger: $code / $signal', async (details) => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(11_250)
    execFile.mockImplementation((_path, _args, _options, callback) => {
      callback(Object.assign(new Error('version check failed'), details))
    })
    const error = await defaultPreflightDependencies.checkExecutable('ffprobe', 10_000).catch((error) => error)
    expect(error).toBeInstanceOf(Error)
    const lines: string[] = []
    createJsonLogger({ write: (line) => lines.push(line) }).error('worker.startup_failed', { error })
    const message = JSON.parse(lines[0]!).error.message as string
    expect(message).toContain('Executable preflight failed for ffprobe:')
    expect(message).toContain('version check failed')
    expect(message).toContain(
      JSON.stringify({
        elapsedMs: 10_250,
        timeoutMs: 10_000,
        code: details.code,
        signal: details.signal ?? null,
        killed: details.killed ?? null
      })
    )
  })

  it('retains diagnostics when Worker presence truncates long child output', async () => {
    execFile.mockImplementation((_path, _args, _options, callback) => {
      callback(Object.assign(new Error('x'.repeat(4_096)), { code: 1 }))
    })
    const error = await defaultPreflightDependencies.checkExecutable('ffprobe', 10_000).catch((error) => error)
    const persisted = errorMessage(error)
    expect(persisted).toHaveLength(2_048)
    expect(persisted).toContain('"timeoutMs":10000,"code":1,"signal":null,"killed":null')
  })

  it('accepts a successful version check and retains the timeout and abort signal', async () => {
    execFile.mockImplementation((_path, _args, _options, callback) => callback(null))
    const signal = new AbortController().signal
    await expect(defaultPreflightDependencies.checkExecutable('ffmpeg', 10_000, signal)).resolves.toBeUndefined()
    expect(execFile).toHaveBeenCalledWith(
      'ffmpeg',
      ['-version'],
      expect.objectContaining({ timeout: 10_000, signal }),
      expect.any(Function)
    )
  })
})
