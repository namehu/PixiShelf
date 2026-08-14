import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn }))

import { runMediaProcess } from '../media-process.js'

describe('video media process lifecycle', () => {
  beforeEach(() => {
    vi.useRealTimers()
    spawn.mockReset()
  })

  it('kills on abort but does not settle until the child close event', async () => {
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const controller = new AbortController()
    const process = runMediaProcess('ffmpeg', ['-version'], {
      timeoutMs: 10_000,
      signal: controller.signal
    })
    let settled = false
    void process.catch(() => {
      settled = true
    })

    controller.abort(new Error('cancelled'))
    await Promise.resolve()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(settled).toBe(false)

    child.emit('close', null)
    await expect(process).rejects.toThrow('cancelled')
  })

  it('waits for close after a timeout instead of abandoning a live process', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    spawn.mockReturnValue(child)
    const process = runMediaProcess('ffprobe', ['input.mp4'], {
      timeoutMs: 1_000,
      signal: new AbortController().signal
    })
    let settled = false
    void process.catch(() => {
      settled = true
    })
    const rejection = expect(process).rejects.toThrow('ffprobe timed out')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(settled).toBe(false)
    child.emit('close', null)
    await rejection
  })
})

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    killed: boolean
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = vi.fn(() => {
    child.killed = true
    return true
  })
  return child
}
