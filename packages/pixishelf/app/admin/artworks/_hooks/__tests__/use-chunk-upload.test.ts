import { File as NodeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixtureAuthorization, fixtureReceipt } from '@/services/artwork-service/__tests__/media-content-fixture'
import { useChunkUpload } from '../use-chunk-upload'

const confirmMock = vi.hoisted(() => vi.fn((options: { onConfirm: () => void }) => options.onConfirm()))
vi.mock('@/components/shared/global-confirm', () => ({ confirm: confirmMock }))

const account = vi.hoisted(() => ({ userId: 'upload-fixture-user' }))
vi.mock('@/lib/auth/client', () => ({ useSession: () => ({ data: { user: { id: account.userId } } }) }))
const chunkSize = 10 * 1024 * 1024
const file = (first = 1) =>
  new NodeFile([Buffer.alloc(chunkSize, first), Buffer.from('end')], 'fixture.mp4') as unknown as File
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response
const auth = fixtureAuthorization('work/fixture.mp4')
const final = {
  type: 'final',
  authorization: auth,
  committedBytes: chunkSize + 3,
  nextChunkIndex: 2,
  meta: [
    {
      fileName: 'fixture.mp4',
      path: '/work/fixture.mp4',
      size: chunkSize + 3,
      order: 0,
      width: 0,
      height: 0,
      uploadReceipt: fixtureReceipt('work/fixture.mp4')
    }
  ]
}

beforeEach(() => {
  localStorage.clear()
  account.userId = 'upload-fixture-user'
  vi.stubGlobal('crypto', webcrypto)
})
afterEach(() => vi.unstubAllGlobals())

describe('persistent upload client', () => {
  it('recovers a lost acknowledgement after remount with original credentials and verified prefix', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(
        response({ exists: true, size: chunkSize, nextChunkIndex: 1, status: 'ACTIVE', authorization: auth })
      )
      .mockResolvedValueOnce(response(final))
    vi.stubGlobal('fetch', fetchMock)
    const first = renderHook(() => useChunkUpload())
    await act(async () => {
      await expect(first.result.current.uploadSingleFile(file(), 'fixture.mp4', 'work', 'work')).rejects.toThrow(
        'response lost'
      )
    })
    const originalHeaders = fetchMock.mock.calls[0]![1].headers
    first.unmount()
    const resumed = renderHook(() => useChunkUpload())
    await act(async () => {
      await expect(
        resumed.result.current.uploadSingleFile(file(), 'fixture.mp4', 'work', 'work')
      ).resolves.toMatchObject({ fileName: 'fixture.mp4' })
    })
    expect(fetchMock.mock.calls[1]![1].headers['x-upload-token']).toBe(originalHeaders['x-upload-token'])
    expect(fetchMock.mock.calls[2]![1].headers).toMatchObject({ 'x-chunk-index': '1', 'x-offset': String(chunkSize) })
  })

  it('does not append a different selected file to a saved prefix', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(
        response({ exists: true, size: chunkSize, nextChunkIndex: 1, status: 'ACTIVE', authorization: auth })
      )
    vi.stubGlobal('fetch', fetchMock)
    const first = renderHook(() => useChunkUpload())
    await expect(first.result.current.uploadSingleFile(file(), 'fixture.mp4', 'work', 'work')).rejects.toThrow(
      'response lost'
    )
    first.unmount()
    const resumed = renderHook(() => useChunkUpload())
    await expect(resumed.result.current.uploadSingleFile(file(2), 'fixture.mp4', 'work', 'work')).rejects.toThrow(
      '内容不同'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('explicitly restarts a failed upload with the new version and a fresh first chunk request', async () => {
    const restarted = { ...auth, handle: { ...auth.handle, declarationVersion: '2' } }
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(
        response({ exists: true, size: 0, nextChunkIndex: 0, status: 'RECOVERY_REQUIRED', authorization: auth })
      )
      .mockResolvedValueOnce(
        response({ exists: true, size: 0, nextChunkIndex: 0, status: 'ACTIVE', authorization: restarted })
      )
      .mockResolvedValueOnce(
        response({ type: 'chunk', committedBytes: chunkSize, nextChunkIndex: 1, authorization: restarted })
      )
      .mockResolvedValueOnce(response({ ...final, authorization: restarted }))
    vi.stubGlobal('fetch', fetchMock)
    const first = renderHook(() => useChunkUpload())
    await expect(first.result.current.uploadSingleFile(file(), 'fixture.mp4', 'work', 'work')).rejects.toThrow(
      'response lost'
    )
    const originalRequest = fetchMock.mock.calls[0]![1].headers['x-upload-request-id']
    first.unmount()
    const resumed = renderHook(() => useChunkUpload())
    await expect(resumed.result.current.uploadSingleFile(file(), 'fixture.mp4', 'work', 'work')).resolves.toMatchObject(
      { fileName: 'fixture.mp4' }
    )
    expect(confirmMock).toHaveBeenCalled()
    expect(fetchMock.mock.calls[2]![1]).toMatchObject({
      method: 'PATCH',
      headers: { 'x-upload-authorization': JSON.stringify(auth) }
    })
    expect(fetchMock.mock.calls[3]![1].headers).toMatchObject({
      'x-chunk-index': '0',
      'x-offset': '0',
      'x-upload-authorization': JSON.stringify(restarted)
    })
    expect(fetchMock.mock.calls[3]![1].headers['x-upload-request-id']).not.toBe(originalRequest)
  })

  it('never reads another account upload checkpoint', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('stop'))
    vi.stubGlobal('fetch', fetchMock)
    const first = renderHook(() => useChunkUpload())
    await expect(first.result.current.uploadSingleFile(file(), 'fixture.mp4', 'work', 'work')).rejects.toThrow('stop')
    const originalToken = fetchMock.mock.calls[0]![1].headers['x-upload-token']
    first.unmount()
    account.userId = 'other-user'
    const second = renderHook(() => useChunkUpload())
    await expect(second.result.current.uploadSingleFile(file(), 'fixture.mp4', 'work', 'work')).rejects.toThrow('stop')
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({
      method: 'POST',
      headers: { 'x-expected-user-id': 'other-user' }
    })
    expect(fetchMock.mock.calls[1]![1].headers['x-upload-token']).not.toBe(originalToken)
  })
})
