import { describe, expect, it } from 'vitest'
import { runVideoProcess } from '../process-runner.js'

describe('video process runner', () => {
  it('kills a timed-out process and reports a stable timeout error', async () => {
    const signal = new AbortController().signal
    await expect(
      runVideoProcess({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        timeoutMs: 50,
        signal
      })
    ).rejects.toMatchObject({ code: 'EXTERNAL_PROCESS_TIMEOUT' })
  })

  it('terminates an in-flight process when the worker signal is aborted', async () => {
    const controller = new AbortController()
    const execution = runVideoProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 10_000,
      signal: controller.signal
    })
    controller.abort(new Error('worker stopping'))
    await expect(execution).rejects.toThrow('worker stopping')
  })
})
