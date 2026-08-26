import { describe, expect, it, vi } from 'vitest'
import { createBrowserUuid, type BrowserUuidCrypto } from '../browser-uuid'

function cryptoWithBytes(values: number[]): BrowserUuidCrypto {
  return {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (!(array instanceof Uint8Array)) throw new TypeError('Expected a Uint8Array')
      array.set(values)
      return array
    }
  }
}

describe('createBrowserUuid', () => {
  it('uses the native randomUUID implementation when available', () => {
    const randomUUID = vi.fn(() => '8d434276-8e67-4ea5-b586-0b8afcdfc3b7' as const)
    const cryptoApi = { ...cryptoWithBytes([]), randomUUID }

    expect(createBrowserUuid(cryptoApi)).toBe('8d434276-8e67-4ea5-b586-0b8afcdfc3b7')
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('creates an RFC 4122 UUID v4 when randomUUID is unavailable', () => {
    const cryptoApi = cryptoWithBytes(Array.from({ length: 16 }, (_, index) => index))

    expect(createBrowserUuid(cryptoApi)).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })
})
