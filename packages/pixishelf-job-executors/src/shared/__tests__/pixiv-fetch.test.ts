import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent, ProxyAgent } from 'undici'
import { createPixivFetchTransport, type PixivFetchTransport } from '../pixiv-fetch.ts'
import { PixivProxyConfigurationError } from '../pixiv-proxy-error.ts'

vi.mock('undici', () => ({
  Agent: class {
    destroy = vi.fn(async () => undefined)
  },
  ProxyAgent: class {
    destroy = vi.fn(async () => undefined)
    constructor(readonly uri: string) {}
  }
}))

const apiUrl = 'https://www.pixiv.net/ajax/user/123'
const imageUrl = 'https://i.pximg.net/avatar.png'
const transports: PixivFetchTransport[] = []
function transport(environment: Record<string, string | undefined>) {
  const result = createPixivFetchTransport(environment)
  transports.push(result)
  return result
}

afterEach(async () => {
  await Promise.all(transports.splice(0).map((item) => item.close()))
  vi.restoreAllMocks()
})

describe('Pixiv outbound proxy selection', () => {
  it.each([
    [
      { ARCHIVE_HTTPS_PROXY: 'http://proxy:7890', HTTPS_PROXY: 'http://other:8080', NO_PROXY: '*' },
      'http://proxy:7890/'
    ],
    [{ HTTPS_PROXY: 'https://proxy:8443', HTTP_PROXY: 'http://other:8080' }, 'https://proxy:8443/'],
    [{ https_proxy: 'http://proxy:7890', HTTP_PROXY: 'http://other:8080' }, 'http://proxy:7890/'],
    [{ HTTP_PROXY: 'http://proxy:7890' }, 'http://proxy:7890/'],
    [{ http_proxy: 'http://proxy:7890' }, 'http://proxy:7890/'],
    [{ HTTPS_PROXY: 'http://proxy:7890', NO_PROXY: 'pixiv.net:8443' }, 'http://proxy:7890/']
  ])('selects the existing archive proxy rules for %j', async (environment, uri) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    await transport(environment).fetch(apiUrl)
    expect(fetchMock).toHaveBeenCalledWith(apiUrl, {
      dispatcher: expect.objectContaining({ uri }),
      redirect: 'manual'
    })
  })

  it.each([
    {},
    { ARCHIVE_HTTPS_PROXY: '', HTTPS_PROXY: 'http://proxy:7890' },
    { HTTPS_PROXY: 'http://proxy:7890', NO_PROXY: '*' },
    { HTTPS_PROXY: 'http://proxy:7890', NO_PROXY: '.pixiv.net' },
    { HTTPS_PROXY: 'http://proxy:7890', no_proxy: 'www.pixiv.net:443' }
  ])('uses an explicit direct dispatcher for %j', async (environment) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    await transport(environment).fetch(apiUrl)
    expect(fetchMock).toHaveBeenCalledWith(apiUrl, { dispatcher: expect.any(Agent), redirect: 'manual' })
  })

  it('re-evaluates bypass per target and reuses each connection pool', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'))
    const client = transport({ HTTPS_PROXY: 'http://proxy:7890', NO_PROXY: 'www.pixiv.net' })
    await client.fetch(apiUrl)
    await client.fetch(imageUrl)
    await client.fetch(imageUrl)
    await client.fetch(apiUrl)
    const options = fetchMock.mock.calls.map((call) => call[1] as RequestInit & { dispatcher: Agent | ProxyAgent })
    expect(options[0]!.dispatcher).toBeInstanceOf(Agent)
    expect(options[1]!.dispatcher).toBeInstanceOf(ProxyAgent)
    expect(options[2]!.dispatcher).toBe(options[1]!.dispatcher)
    expect(options[3]!.dispatcher).toBe(options[0]!.dispatcher)
    const close = client.close()
    expect(client.close()).toBe(close)
    await close
    expect(options[0]!.dispatcher.destroy).toHaveBeenCalledOnce()
    expect(options[1]!.dispatcher.destroy).toHaveBeenCalledOnce()
    await expect(client.fetch(apiUrl)).rejects.toThrow('已关闭')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('preserves the signal, headers, response and manual redirect boundary', async () => {
    const response = new Response(null, { status: 302, headers: { location: '/next' } })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    const controller = new AbortController()
    const request = new Request(apiUrl)
    const result = await transport({ ARCHIVE_HTTPS_PROXY: 'http://proxy:7890' }).fetch(request, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      redirect: 'follow'
    })
    expect(result).toBe(response)
    expect(fetchMock).toHaveBeenCalledWith(request, {
      dispatcher: expect.any(ProxyAgent),
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'application/json' }
    })
  })

  it('never retries a failed proxy request with a direct dispatcher', async () => {
    const failure = new TypeError('fetch failed')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(failure)
    await expect(transport({ ARCHIVE_HTTPS_PROXY: 'http://proxy:7890' }).fetch(apiUrl)).rejects.toBe(failure)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(apiUrl, { dispatcher: expect.any(ProxyAgent), redirect: 'manual' })
  })

  it.each([
    'not a URL secret',
    'socks5://proxy:7890',
    'http://user:secret@proxy:7890',
    'http://proxy/private',
    'http://proxy?token=secret',
    'http://proxy#secret'
  ])('rejects invalid proxy configuration without I/O: %s', async (proxy) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const result = transport({ ARCHIVE_HTTPS_PROXY: proxy }).fetch(apiUrl)
    await expect(result).rejects.toBeInstanceOf(PixivProxyConfigurationError)
    await expect(result).rejects.not.toHaveProperty('cause')
    await expect(result).rejects.not.toThrow('secret')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'http://www.pixiv.net/',
    'https://www.pixiv.net:444/',
    'https://other.pixiv.net/',
    'https://127.0.0.1/',
    'https://user:secret@www.pixiv.net/'
  ])('rejects a target outside the Pixiv boundary: %s', async (url) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    await expect(transport({}).fetch(url)).rejects.toThrow('不在允许列表')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
