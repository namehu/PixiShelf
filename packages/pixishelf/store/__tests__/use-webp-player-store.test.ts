import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWebpPlayerStore as store, WEBP_PLAYER_SESSION_KEY } from '../use-webp-player-store'

const version = '0123456789abcdef'
const response = (value: unknown = { version }) => ({ ok: true, json: async () => value }) as Response
function deferred() {
  let resolve!: (value: Response) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<Response>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  store.getState().reset()
  sessionStorage.clear()
})
afterEach(() => {
  store.getState().reset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('WebP session manifest cache', () => {
  it('deduplicates in-flight requests and reuses a successful result across consumers', async () => {
    const request = deferred()
    const fetch = vi.fn(() => request.promise)
    vi.stubGlobal('fetch', fetch)
    const first = store.getState().loadManifest()
    expect(store.getState().loadManifest()).toBe(first)
    expect(fetch).toHaveBeenCalledTimes(1)
    request.resolve(response())
    await expect(first).resolves.toEqual({ version })
    await expect(store.getState().loadManifest()).resolves.toEqual({ version })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.getState().pending).toBeNull()
  })

  it.each(['network', 'http', 'json', 'invalid'])(
    'does not cache a %s failure and permits a later retry',
    async (failure) => {
      const fetch = vi.fn().mockResolvedValueOnce(response())
      if (failure === 'network') fetch.mockReset().mockRejectedValueOnce(new Error('offline'))
      if (failure === 'http') fetch.mockReset().mockResolvedValueOnce({ ok: false })
      if (failure === 'json') {
        fetch.mockReset().mockResolvedValueOnce({
          ok: true,
          json: async () => {
            throw new Error('bad JSON')
          }
        })
      }
      if (failure === 'invalid') fetch.mockReset().mockResolvedValueOnce(response({ version: '../unsafe' }))
      fetch.mockResolvedValueOnce(response())
      vi.stubGlobal('fetch', fetch)
      await expect(store.getState().loadManifest()).rejects.toThrow()
      expect(store.getState()).toMatchObject({ manifest: null, pending: null, controller: null })
      await expect(store.getState().loadManifest()).resolves.toEqual({ version })
      expect(fetch).toHaveBeenCalledTimes(2)
    }
  )

  it('persists only validated data in sessionStorage and restores it without fetching', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ version, extra: 'unused' }))
    vi.stubGlobal('fetch', fetch)
    store.getState().setSessionOwner('alice')
    await store.getState().loadManifest()
    const saved = sessionStorage.getItem(WEBP_PLAYER_SESSION_KEY)!
    expect(JSON.parse(saved).state).toEqual({ ownerId: 'alice', manifest: { version } })
    store.getState().reset()
    sessionStorage.setItem(WEBP_PLAYER_SESSION_KEY, saved)
    await store.persist.rehydrate()
    store.getState().setSessionOwner('alice')
    await expect(store.getState().loadManifest()).resolves.toEqual({ version })
    expect(fetch).toHaveBeenCalledTimes(1)
    store.getState().setSessionOwner('bob')
    await store.getState().loadManifest()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects stale responses after a session change without erasing the new request', async () => {
    const old = deferred(),
      next = deferred()
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    vi.stubGlobal('fetch', fetch)
    store.getState().setSessionOwner('alice')
    const oldLoad = store.getState().loadManifest()
    const rejected = expect(oldLoad).rejects.toMatchObject({ name: 'AbortError' })
    const signal = fetch.mock.calls[0]![1].signal as AbortSignal
    store.getState().setSessionOwner('bob')
    expect(signal.aborted).toBe(true)
    const nextLoad = store.getState().loadManifest()
    old.resolve(response())
    await rejected
    expect(store.getState().pending).toBe(nextLoad)
    next.resolve(response({ version: 'fedcba9876543210' }))
    await nextLoad
    expect(store.getState()).toMatchObject({ ownerId: 'bob', manifest: { version: 'fedcba9876543210' } })
  })

  it('rejects invalid persisted data and never restores actions from storage', async () => {
    sessionStorage.setItem(
      WEBP_PLAYER_SESSION_KEY,
      JSON.stringify({ state: { manifest: { version: '/bad' }, loadManifest: 'bad' }, version: 0 })
    )
    await store.persist.rehydrate()
    expect(store.getState().manifest).toBeNull()
    expect(typeof store.getState().loadManifest).toBe('function')
  })

  it('still caches in memory when sessionStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    const fetch = vi.fn().mockResolvedValue(response())
    vi.stubGlobal('fetch', fetch)
    await store.getState().loadManifest()
    await store.getState().loadManifest()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
