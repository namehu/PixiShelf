import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { assertSuccessStatus, isPublicNetworkAddress, readResponseBuffer, validateArchiveUrl } from '../safe-http'

describe('archive safe HTTP network policy', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.0.2.1',
    '198.51.100.2',
    '203.0.113.3',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1'
  ])('rejects non-public address %s', (address) => {
    expect(isPublicNetworkAddress(address)).toBe(false)
  })

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('accepts public address %s', (address) => {
    expect(isPublicNetworkAddress(address)).toBe(true)
  })

  it('accepts only credential-free HTTPS URLs on an exact allowed suffix', () => {
    expect(validateArchiveUrl('https://api.e-hentai.org/api.php', ['e-hentai.org']).hostname).toBe(
      'api.e-hentai.org'
    )
    expect(() => validateArchiveUrl('http://e-hentai.org/', ['e-hentai.org'])).toThrowError(
      expect.objectContaining({ code: 'SSRF_BLOCKED' })
    )
    expect(() => validateArchiveUrl('https://e-hentai.org.evil.test/', ['e-hentai.org'])).toThrowError(
      expect.objectContaining({ code: 'SSRF_BLOCKED' })
    )
    expect(() => validateArchiveUrl('https://user:secret@e-hentai.org/', ['e-hentai.org'])).toThrowError(
      expect.objectContaining({ code: 'SSRF_BLOCKED' })
    )
  })

  it.each([
    [403, 'REMOTE_FORBIDDEN'],
    [429, 'REMOTE_RATE_LIMITED'],
    [509, 'REMOTE_QUOTA_EXCEEDED']
  ])('classifies HTTP %s as a paused response', (status, code) => {
    expect(() =>
      assertSuccessStatus({
        status: Number(status),
        headers: {},
        stream: Readable.from([]) as unknown as IncomingMessage,
        url: 'https://example.test'
      })
    ).toThrowError(expect.objectContaining({ code, pause: true }))
  })

  it('rejects a buffered response that exceeds its configured limit', async () => {
    await expect(
      readResponseBuffer(
        {
          status: 200,
          headers: {},
          stream: Readable.from([Buffer.alloc(5)]) as unknown as IncomingMessage,
          url: 'https://example.test'
        },
        4
      )
    ).rejects.toMatchObject({ code: 'DOWNLOAD_TOO_LARGE' })
  })
})
