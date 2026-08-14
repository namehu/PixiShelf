import { beforeEach, describe, expect, it, vi } from 'vitest'

const { lookupMock, requestMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  requestMock: vi.fn()
}))

vi.mock('node:dns/promises', () => ({
  default: { lookup: lookupMock }
}))

vi.mock('node:https', async () => {
  const actual = await vi.importActual<typeof import('node:https')>('node:https')
  return {
    ...actual,
    default: { ...actual, request: requestMock },
    request: requestMock
  }
})

import { SafeHttpClient } from '../safe-http.js'

describe('archive safe HTTP cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lookupMock.mockResolvedValue([{ address: '1.1.1.1', family: 4 }])
  })

  it('rejects an already-aborted direct request before opening a socket', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = new SafeHttpClient(['example.test'], { ARCHIVE_HTTPS_PROXY: '' })

    await expect(
      client.request('https://example.test/media.webp', { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'CANCELLED', recoverable: true })
    expect(requestMock).not.toHaveBeenCalled()
  })
})
