import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))

import { probeVideoDuration } from '../media-process.js'

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('video keyframe process lifecycle', () => {
  it('kills an aborted process and waits for close before rejecting', async () => {
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const controller = new AbortController()
    const promise = probeVideoDuration({
      sourcePath: '/scan/video.mp4',
      timeoutMs: 60_000,
      signal: controller.signal
    })
    let settled = false
    void promise
      .finally(() => {
        settled = true
      })
      .catch(() => undefined)

    controller.abort(new Error('cancel requested'))
    await Promise.resolve()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(settled).toBe(false)
    child.emit('close', null)
    await expect(promise).rejects.toThrow('cancel requested')
  })

  it('kills a timed-out process and waits for close before reporting timeout', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const promise = probeVideoDuration({
      sourcePath: '/scan/video.mp4',
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })
    let settled = false
    void promise
      .finally(() => {
        settled = true
      })
      .catch(() => undefined)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(settled).toBe(false)
    child.emit('close', null)
    await expect(promise).rejects.toMatchObject({ code: 'EXTERNAL_PROCESS_TIMEOUT' })
  })
})

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    killed: boolean
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = vi.fn(() => {
    child.killed = true
    return true
  })
  return child
}
