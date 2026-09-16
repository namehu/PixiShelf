import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { resolveArchiveUploaderIdentity } from '../archive-uploader-identity'

function fixture() {
  const scanUploader = vi
    .fn()
    .mockResolvedValue({ discoveredUploaderUid: '123', items: [{ uploaderName: 'Alice', externalId: '300' }] })
  const findFirst = vi.fn().mockResolvedValue(null)
  return {
    scanUploader,
    findFirst,
    dependencies: {
      database: { archiveUploaderSource: { findFirst } } as never,
      uploaderProviders: { getUploaderScanner: () => ({ scanUploader }) } as never
    }
  }
}

afterEach(() => vi.useRealTimers())
describe('uploader identity lookup before creation', () => {
  it('coalesces normalized in-flight names and returns an existing source without writes', async () => {
    const { scanUploader, findFirst, dependencies } = fixture()
    findFirst.mockResolvedValue({ id: 'existing', displayName: 'Alice', status: 'ARCHIVED' })
    const results = await Promise.all([
      resolveArchiveUploaderIdentity({ name: ' Ａlice ' }, dependencies),
      resolveArchiveUploaderIdentity({ name: 'alice' }, dependencies)
    ])
    expect(scanUploader).toHaveBeenCalledTimes(1)
    expect(scanUploader).toHaveBeenCalledWith(
      expect.objectContaining({ identityKind: 'NAME', identityValue: 'Alice', limit: 1 }),
      { signal: expect.any(AbortSignal) }
    )
    expect(results[0]).toEqual(results[1])
    expect(results[0]).toMatchObject({
      outcome: 'MATCHED',
      uploaderUid: '123',
      existingSource: { id: 'existing', status: 'ARCHIVED' }
    })
  })

  it('distinguishes missing evidence and unavailable remote access from an invalid name', async () => {
    const { scanUploader, dependencies } = fixture()
    scanUploader.mockResolvedValueOnce({ discoveredUploaderUid: null, items: [] })
    await expect(resolveArchiveUploaderIdentity({ name: 'Alice' }, dependencies)).resolves.toMatchObject({
      outcome: 'UNRESOLVED',
      reason: 'NOT_FOUND'
    })
    scanUploader.mockRejectedValueOnce({ code: 'REMOTE_RATE_LIMITED' })
    await expect(resolveArchiveUploaderIdentity({ name: 'Alice' }, dependencies)).resolves.toMatchObject({
      reason: 'RATE_LIMITED'
    })
    await expect(resolveArchiveUploaderIdentity({ name: 'Alice"' }, dependencies)).rejects.toThrow()
    expect(scanUploader).toHaveBeenCalledTimes(2)
  })

  it('aborts actual work at the deadline and does not publish a late result', async () => {
    vi.useFakeTimers()
    const { scanUploader, findFirst, dependencies } = fixture()
    let signal: AbortSignal | undefined
    let finish!: (value: unknown) => void
    scanUploader.mockImplementation((_input, context) => {
      signal = context.signal
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    const request = resolveArchiveUploaderIdentity({ name: 'Alice' }, dependencies)
    await vi.advanceTimersByTimeAsync(20_000)
    await expect(request).resolves.toMatchObject({ reason: 'TIMEOUT' })
    expect(signal?.aborted).toBe(true)
    finish({ discoveredUploaderUid: '999', items: [{ uploaderName: 'Alice', externalId: '300' }] })
    await vi.advanceTimersByTimeAsync(0)
    expect(findFirst).not.toHaveBeenCalled()
  })
})
