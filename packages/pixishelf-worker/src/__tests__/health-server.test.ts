import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkerHealthState } from '@pixishelf/job-runtime'
import { checkWorkerHealth } from '../healthcheck.js'
import { createWorkerHealthServer, type WorkerHealthServer } from '../health-server.js'

describe('worker health server', () => {
  let server: WorkerHealthServer | undefined
  afterEach(async () => server?.close())

  it('keeps liveness local and gates readiness on preflight and draining', async () => {
    const state = new WorkerHealthState()
    server = createWorkerHealthServer({
      state,
      host: '127.0.0.1',
      port: 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    await server.start()
    const port = server.address()?.port
    expect(port).toBeTypeOf('number')

    await expect(
      checkWorkerHealth({ mode: 'live', host: '127.0.0.1', port: port!, timeoutMs: 1_000 })
    ).resolves.toBeUndefined()
    await expect(
      checkWorkerHealth({ mode: 'ready', host: '127.0.0.1', port: port!, timeoutMs: 1_000 })
    ).rejects.toThrow('HTTP 503')

    state.completePreflight()
    await expect(
      checkWorkerHealth({ mode: 'ready', host: '127.0.0.1', port: port!, timeoutMs: 1_000 })
    ).resolves.toBeUndefined()
    state.beginDrain()
    await expect(
      checkWorkerHealth({ mode: 'ready', host: '127.0.0.1', port: port!, timeoutMs: 1_000 })
    ).rejects.toThrow('HTTP 503')
    await expect(
      checkWorkerHealth({ mode: 'live', host: '127.0.0.1', port: port!, timeoutMs: 1_000 })
    ).resolves.toBeUndefined()
  })

  it('serializes an immediate close with an in-flight listen', async () => {
    const state = new WorkerHealthState()
    server = createWorkerHealthServer({
      state,
      host: '127.0.0.1',
      port: 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })

    const starting = server.start()
    const closing = server.close()
    await Promise.all([starting, closing])

    expect(server.address()).toBeNull()
    await expect(server.start()).rejects.toThrow('Health server is closing')
  })

  it('does not expose failure details through readiness', async () => {
    const state = new WorkerHealthState()
    state.fail(new Error('postgresql://worker:super-secret@postgres/pixishelf'))
    server = createWorkerHealthServer({
      state,
      host: '127.0.0.1',
      port: 0,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    await server.start()

    const response = await fetch(`http://127.0.0.1:${server.address()?.port}/readyz`)
    const body = await response.text()
    expect(response.status).toBe(503)
    expect(body).toBe(JSON.stringify({ ok: false, draining: false }))
    expect(body).not.toContain('super-secret')
  })
})
