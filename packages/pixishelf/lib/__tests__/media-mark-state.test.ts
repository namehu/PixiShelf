import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMediaMarkSession, MediaMarkSession, type MediaMarkTransport } from '../media-mark-state'
import type { MediaMarkKind, MediaMarkStateDto } from '@/schemas/media-mark.dto'

const date = '2026-10-22T12:00:00.000Z'
const state = (bookmark = false, like = false): MediaMarkStateDto => ({
  markId: bookmark || like ? 'mark-1' : null, artworkId: 7, mediaId: 42,
  bookmarkedAt: bookmark ? date : null, likedAt: like ? date : null, available: true
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const clients: QueryClient[] = []
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  clients.push(client)
  const transport = {
    get: vi.fn(async () => state()),
    set: vi.fn(async (kind: MediaMarkKind, value: boolean) => state(kind === 'bookmark' && value, kind === 'like' && value)),
    remove: vi.fn(async () => ({ success: true })),
    isCurrentAccount: vi.fn(() => true),
    onConfirmed: vi.fn(async () => {})
  } satisfies MediaMarkTransport
  const session = new MediaMarkSession(client, { owner: 'alice', artworkId: 7, mediaId: 42 }, transport, state())
  return { client, transport, session }
}
afterEach(() => clients.splice(0).forEach((client) => client.clear()))

describe('shared media marks', () => {
  it('preserves both optimistic fields and serializes/coalesces quick gestures', async () => {
    const { session, transport } = setup()
    const first = deferred<MediaMarkStateDto>()
    const like = deferred<MediaMarkStateDto>()
    transport.set.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => like.promise)
    session.set('bookmark', true)
    session.set('like', true)
    session.set('like', false)
    session.set('like', true)
    expect(transport.set.mock.calls).toEqual([['bookmark', true]])
    first.resolve(state(true))
    await vi.waitFor(() => expect(transport.set.mock.calls).toEqual([['bookmark', true], ['like', true]]))
    expect(session.getSnapshot().bookmarkedAt).toBeTruthy()
    expect(session.getSnapshot().likedAt).toBeTruthy()
    like.resolve(state(true, true))
    await vi.waitFor(() => expect(session.getSnapshot().isSaving).toBe(false))
    expect(session.getSnapshot()).toMatchObject(state(true, true))
  })

  it('rolls back one failed mark without losing the other pending change', async () => {
    const { session, transport } = setup()
    const first = deferred<MediaMarkStateDto>()
    transport.set.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(state(false, true))
    session.set('bookmark', true)
    session.set('like', true)
    first.reject(new Error('offline'))
    await vi.waitFor(() => expect(session.getSnapshot().isSaving).toBe(false))
    expect(session.getSnapshot()).toMatchObject({ bookmarkedAt: null, likedAt: date, error: expect.any(Error) })
  })

  it('queues a list removal after an earlier save and leaves the other kind untouched', async () => {
    const { session, transport } = setup()
    const first = deferred<MediaMarkStateDto>()
    transport.set.mockImplementationOnce(() => first.promise)
    session.set('bookmark', true)
    session.remove('bookmark', 'mark-1')
    expect(transport.remove).not.toHaveBeenCalled()
    first.resolve(state(true, true))
    await vi.waitFor(() => expect(session.getSnapshot().isSaving).toBe(false))
    expect(transport.remove).toHaveBeenCalledWith('mark-1', 'bookmark')
    expect(session.getSnapshot()).toMatchObject({ bookmarkedAt: null, likedAt: date })
  })

  it('does not let an old read overwrite a newer gesture', async () => {
    const { session, transport, client } = setup()
    const read = deferred<MediaMarkStateDto>()
    await client.invalidateQueries()
    transport.get.mockImplementationOnce(() => read.promise)
    const loading = session.load()
    session.set('bookmark', true)
    await vi.waitFor(() => expect(session.getSnapshot().isSaving).toBe(false))
    read.resolve(state())
    await loading
    expect(session.getSnapshot().bookmarkedAt).toBeTruthy()
  })

  it('ignores an old request after A → B → A and does not clear the new queue', async () => {
    const { session, transport } = setup()
    const old = deferred<MediaMarkStateDto>()
    const fresh = deferred<MediaMarkStateDto>()
    transport.set.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise)
    session.set('bookmark', true)
    transport.isCurrentAccount.mockReturnValue(false)
    session.deactivate()
    transport.isCurrentAccount.mockReturnValue(true)
    session.set('like', true)
    old.resolve(state(true))
    await Promise.resolve()
    expect(session.getSnapshot()).toMatchObject({ bookmarkedAt: null, isSaving: true })
    expect(session.getSnapshot().likedAt).toBeTruthy()
    fresh.resolve(state(false, true))
    await vi.waitFor(() => expect(session.getSnapshot().isSaving).toBe(false))
    expect(transport.onConfirmed).toHaveBeenCalledOnce()
    expect(session.getSnapshot()).toMatchObject(state(false, true))
  })

  it('shares state across entrances and separates account identities', () => {
    const { client, transport } = setup()
    const a = getMediaMarkSession(client, { owner: 'alice', artworkId: 7, mediaId: 42 }, transport, state())
    expect(getMediaMarkSession(client, { owner: 'alice', artworkId: 7, mediaId: 42 }, transport)).toBe(a)
    expect(getMediaMarkSession(client, { owner: 'bob', artworkId: 7, mediaId: 42 }, transport)).not.toBe(a)
  })
})
