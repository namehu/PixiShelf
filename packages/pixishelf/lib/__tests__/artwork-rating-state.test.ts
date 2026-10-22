import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtworkRatingSession, getArtworkRatingSession, type ArtworkRatingTransport } from '../artwork-rating-state'
import type { ArtworkRatingLevel, ArtworkRatingState } from '@/schemas/artwork-rating.dto'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const state = (level: ArtworkRatingLevel): ArtworkRatingState => ({
  artworkId: 7, level, isLike: level !== null && level >= 2, updatedAt: level === null ? null : '2026-10-22T12:00:00.000Z'
})
const clients: QueryClient[] = []
function setup(initialLevel: ArtworkRatingLevel = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  const transport = {
    get: vi.fn(async () => state(initialLevel)),
    set: vi.fn(async (level: ArtworkRatingLevel) => state(level)),
    isCurrentAccount: vi.fn(() => true),
    onConfirmed: vi.fn(async () => {}),
    onLoaded: vi.fn()
  } satisfies ArtworkRatingTransport
  const session = new ArtworkRatingSession(client, 'alice', 7, transport, initialLevel)
  return { client, transport, session }
}
afterEach(() => { clients.splice(0).forEach((client) => client.clear()) })

describe('shared personal rating queue', () => {
  it('serializes writes, coalesces repeated gestures, and keeps the latest preview during older acknowledgements', async () => {
    const { session, transport } = setup()
    const first = deferred<ArtworkRatingState>()
    const last = deferred<ArtworkRatingState>()
    transport.set.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => last.promise)
    session.setLevel(2)
    session.setLevel(3)
    session.setLevel(4)
    expect(transport.set.mock.calls).toEqual([[2]])
    expect(session.getSnapshot()).toMatchObject({ level: 4, confirmedLevel: null, isSaving: true })
    first.resolve(state(2))
    await vi.waitFor(() => expect(transport.set.mock.calls).toEqual([[2], [4]]))
    expect(session.getSnapshot()).toMatchObject({ level: 4, confirmedLevel: 2, isSaving: true })
    expect(transport.onConfirmed).not.toHaveBeenCalled()
    last.resolve(state(4))
    await vi.waitFor(() => expect(session.getSnapshot().isSaving).toBe(false))
    expect(transport.onConfirmed).toHaveBeenCalledExactlyOnceWith(state(4))
  })

  it('rolls back only a final failed target and retries that target instead of the fallback', async () => {
    const { session, transport } = setup(1)
    const first = deferred<ArtworkRatingState>()
    transport.set.mockImplementationOnce(() => first.promise).mockRejectedValueOnce(new Error('offline'))
    session.setLevel(2)
    session.setLevel(4)
    first.resolve(state(2))
    await vi.waitFor(() => expect(session.getSnapshot().error?.message).toBe('offline'))
    expect(session.getSnapshot()).toMatchObject({ level: 2, confirmedLevel: 2, isSaving: false })
    session.retry()
    await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ level: 4, confirmedLevel: 4, error: null, isSaving: false }))
    expect(transport.set.mock.calls).toEqual([[2], [4], [4]])
  })

  it('continues the newest target after an intermediate write fails', async () => {
    const { session, transport } = setup()
    const first = deferred<ArtworkRatingState>()
    transport.set.mockImplementationOnce(() => first.promise)
    session.setLevel(2)
    session.setLevel(4)
    first.reject(new Error('first failed'))
    await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ level: 4, isSaving: false, error: null }))
    expect(transport.onConfirmed).toHaveBeenCalledExactlyOnceWith(state(4))
  })

  it('does not let an older read erase a new rating', async () => {
    const { session, transport } = setup()
    const read = deferred<ArtworkRatingState>()
    transport.get.mockImplementationOnce(() => read.promise)
    const loading = session.load()
    session.setLevel(3)
    await vi.waitFor(() => expect(session.getSnapshot().confirmedLevel).toBe(3))
    read.resolve(state(null))
    await loading
    expect(session.getSnapshot()).toMatchObject({ level: 3, confirmedLevel: 3 })
  })

  it('does not refetch a stale value when another entrance mounts during a pending write', async () => {
    const { session, transport } = setup(1)
    const write = deferred<ArtworkRatingState>()
    const staleRead = deferred<ArtworkRatingState>()
    transport.set.mockImplementationOnce(() => write.promise)
    transport.get.mockImplementationOnce(() => staleRead.promise)
    session.setLevel(4)
    const loading = session.load()
    write.resolve(state(4))
    await vi.waitFor(() => expect(session.getSnapshot().confirmedLevel).toBe(4))
    staleRead.resolve(state(1))
    await loading
    expect(session.getSnapshot()).toMatchObject({ level: 4, confirmedLevel: 4, isSaving: false })
    expect(transport.get).not.toHaveBeenCalled()
  })

  it('finishes pending writes without subscribers and shares a session across entrances', async () => {
    const { client, transport } = setup()
    const first = deferred<ArtworkRatingState>()
    transport.set.mockImplementationOnce(() => first.promise)
    const session = getArtworkRatingSession(client, 'alice', 7, transport, null)
    const changed = vi.fn()
    const unsubscribe = session.subscribe(changed)
    session.setLevel(4)
    unsubscribe()
    first.resolve(state(4))
    await vi.waitFor(() => expect(session.getSnapshot().confirmedLevel).toBe(4))
    expect(getArtworkRatingSession(client, 'alice', 7, transport, 1)).toBe(session)
    expect(session.getSnapshot().level).toBe(4)
    expect(getArtworkRatingSession(client, 'bob', 7, transport, 1).getSnapshot().level).toBe(1)
  })

  it('drops queued writes after the account changes and publishes only the old account acknowledgement', async () => {
    const { session, transport } = setup()
    const first = deferred<ArtworkRatingState>()
    transport.set.mockImplementationOnce(() => first.promise)
    session.setLevel(2)
    session.setLevel(4)
    transport.isCurrentAccount.mockReturnValue(false)
    session.deactivate()
    expect(session.getSnapshot()).toMatchObject({ level: null, isSaving: false })
    first.resolve(state(2))
    await vi.waitFor(() => expect(session.getSnapshot().isSaving).toBe(false))
    expect(transport.set.mock.calls).toEqual([[2]])
    expect(transport.onConfirmed).toHaveBeenCalledExactlyOnceWith(state(2))
    session.setLevel(3)
    expect(transport.set).toHaveBeenCalledTimes(1)
  })

  it('retries an initial read failure without issuing a mutation', async () => {
    const { client, transport } = setup()
    transport.get.mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce(state(3))
    const session = new ArtworkRatingSession(client, 'alice', 7, transport)
    await session.load()
    expect(session.getSnapshot()).toMatchObject({ error: expect.any(Error), isLoading: false })
    session.retry()
    expect(session.getSnapshot()).toMatchObject({ error: null, isLoading: true })
    await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ level: 3, isLoading: false, error: null }))
    expect(transport.set).not.toHaveBeenCalled()
  })

  it('does not treat a cache refresh error as a failed database write', async () => {
    const { session, transport } = setup()
    transport.onConfirmed.mockRejectedValueOnce(new Error('refetch failed'))
    session.setLevel(2)
    await vi.waitFor(() => expect(session.getSnapshot()).toMatchObject({ level: 2, confirmedLevel: 2, isSaving: false, error: null }))
  })
})
