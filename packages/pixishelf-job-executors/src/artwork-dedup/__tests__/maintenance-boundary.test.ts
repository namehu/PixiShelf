import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
const workerRequire = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
async function boundary(input: { scenario: string; action?: string; markerChange?: string }) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-boundary-')))
  const child = spawn(
    process.execPath,
    ['--import', workerRequire.resolve('tsx'), new URL('./maintenance-boundary-fixture.ts', import.meta.url).pathname],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }
  )
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  let stderr = ''
  child.stderr?.on('data', (value) => {
    stderr += value.toString()
  })
  try {
    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`fixture timeout: ${stderr}`)), 5000)
      child.once('message', (message) => {
        clearTimeout(timer)
        resolve(message as Record<string, unknown>)
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('close', () => {
        clearTimeout(timer)
        reject(new Error(stderr))
      })
    })
    child.send({ ...input, directory })
    return await result
  } finally {
    child.kill('SIGKILL')
    await closed
    await fs.rm(directory, { recursive: true, force: true })
  }
}
it.each(['rename', 'mkdirAt', 'createFileAt', 'unlinkAt', 'rmdirAt'])(
  'keeps %s anchored when a same-device ancestor is replaced by an outside symlink',
  async (action) => {
    const result = await boundary({ scenario: 'ANCESTOR', action })
    expect(result).toMatchObject({
      swapped: true,
      outsideUnchanged: true,
      originalSource: 'inside',
      targetExists: false
    })
    expect(result.code).toBe('UNSAFE_PATH')
  }
)
it.each(['rename', 'ensure', 'probe', 'sync'])(
  'rejects a new root marker before the first %s write',
  async (action) => {
    expect(await boundary({ scenario: 'MARKER', markerChange: 'ADD', action })).toMatchObject({
      code: 'ROOT_CHANGED',
      trashExists: false,
      originalSource: 'inside',
      targetExists: false
    })
  }
)
it.each(['REMOVE', 'CHANGE'])('rejects marker %s before any probe path is created', async (markerChange) => {
  expect(await boundary({ scenario: 'MARKER', markerChange, action: 'probe' })).toMatchObject({
    code: 'ROOT_CHANGED',
    trashExists: false,
    originalSource: 'inside',
    targetExists: false
  })
})
it('revalidates the full root after opening action directories and before rename', async () => {
  expect(await boundary({ scenario: 'LATE_MARKER' })).toMatchObject({
    code: 'ROOT_CHANGED',
    swapped: true,
    originalSource: 'inside',
    targetExists: false
  })
})
