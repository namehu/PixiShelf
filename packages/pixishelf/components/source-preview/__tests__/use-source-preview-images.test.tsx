import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSourcePreviewImages } from '../use-source-preview-images'

const resolve = vi.hoisted(() => vi.fn())
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({ archivePreview: { image: { mutationOptions: () => ({ mutationFn: resolve }) } } })
}))
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutateAsync: resolve }) }))
class BrowserImage {
  static pending: BrowserImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  referrerPolicy = ''
  naturalWidth = 1200
  naturalHeight = 1800
  src = ''
  removeAttribute() {}
  constructor() {
    BrowserImage.pending.push(this)
  }
}

describe('source display image queue', () => {
  beforeEach(() => {
    resolve.mockReset().mockImplementation(async ({ ordinal }) => ({ ordinal, url: `https://ehgt.org/${ordinal}.jpg` }))
    BrowserImage.pending = []
    vi.stubGlobal('Image', BrowserImage)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })
  it('loads only demand, waits for decoding, and shares the completed image on fullscreen demand', async () => {
    const { result, rerender } = renderHook(({ demand }) => useSourcePreviewImages('session', 0, demand, true), {
      initialProps: { demand: [0, 1] }
    })
    await waitFor(() => expect(BrowserImage.pending).toHaveLength(1))
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(BrowserImage.pending[0]!.referrerPolicy).toBe('no-referrer')
    await act(async () => BrowserImage.pending[0]!.onload?.())
    await waitFor(() => expect(BrowserImage.pending).toHaveLength(2))
    expect(result.current.images.get(0)).toMatchObject({ status: 'loaded', width: 1200, height: 1800 })
    await act(async () => BrowserImage.pending[1]!.onload?.())
    rerender({ demand: [0, 1] })
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(result.current.images.has(2)).toBe(false)
  })
  it('prioritizes new visible demand over queued prefetch and retries explicitly', async () => {
    const { result, rerender } = renderHook(({ demand }) => useSourcePreviewImages('session', 0, demand, true), {
      initialProps: { demand: [0, 1] }
    })
    await waitFor(() => expect(BrowserImage.pending).toHaveLength(1))
    rerender({ demand: [8, 9] })
    await act(async () => BrowserImage.pending[0]!.onload?.())
    await waitFor(() => expect(resolve).toHaveBeenLastCalledWith({ previewId: 'session', ordinal: 8, refresh: false }))
    await act(async () => BrowserImage.pending[1]!.onerror?.())
    expect(result.current.images.get(8)?.status).toBe('failed')
    await waitFor(() => expect(BrowserImage.pending).toHaveLength(3))
    await act(async () => BrowserImage.pending[2]!.onload?.())
    act(() => result.current.retry(8))
    await waitFor(() => expect(resolve).toHaveBeenLastCalledWith({ previewId: 'session', ordinal: 8, refresh: true }))
  })
  it('drops the old image completion when the session changes', async () => {
    const { result, rerender } = renderHook(({ id }) => useSourcePreviewImages(id, 0, [0], true), {
      initialProps: { id: 'old' }
    })
    await waitFor(() => expect(BrowserImage.pending).toHaveLength(1))
    const stale = BrowserImage.pending[0]!.onload
    rerender({ id: 'new' })
    await waitFor(() => expect(BrowserImage.pending).toHaveLength(2))
    await act(async () => stale?.())
    expect(result.current.images.get(0)?.status).toBe('loading')
  })
})
