import { Agent, ProxyAgent, type Dispatcher } from 'undici'
import { resolveArchiveProxyUrl, type ArchiveProxyEnvironment } from '../archive/safe-http.ts'
import { PixivProxyConfigurationError } from './pixiv-proxy-error.ts'

export interface PixivFetchTransport {
  fetch: typeof fetch
  close(): Promise<void>
}

/** Owns only Pixiv connections; never changes the process-wide fetch dispatcher. */
export function createPixivFetchTransport(environment: ArchiveProxyEnvironment = process.env): PixivFetchTransport {
  const proxyAgents = new Map<string, ProxyAgent>()
  let directAgent: Agent | undefined
  let closing: Promise<void> | undefined

  const pixivFetch: typeof fetch = async (input, init) => {
    if (closing) throw new Error('在线同步网络连接已关闭')
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (
      url.protocol !== 'https:' ||
      !['www.pixiv.net', 'i.pximg.net'].includes(url.hostname) ||
      (url.port && url.port !== '443') ||
      url.username ||
      url.password
    ) {
      throw new Error('在线同步请求地址不在允许列表中')
    }

    let proxy: URL | null
    try {
      proxy = resolveArchiveProxyUrl(url, environment)
    } catch {
      // Never retain the original configuration or a credential-bearing cause.
      throw new PixivProxyConfigurationError()
    }

    let dispatcher: Dispatcher
    if (proxy) {
      const key = proxy.href
      let agent = proxyAgents.get(key)
      if (!agent) {
        agent = new ProxyAgent(key)
        proxyAgents.set(key, agent)
      }
      dispatcher = agent
    } else {
      // An explicit direct agent also honors forced-direct mode when another
      // library has installed a global proxy dispatcher.
      dispatcher = directAgent ??= new Agent()
    }

    const options: RequestInit = { ...init, redirect: 'manual' }
    // Node-only and DOM consumers use different RequestInit declarations (and
    // bundled Undici type revisions). The dispatcher is a Node runtime option.
    Object.assign(options, { dispatcher })
    return globalThis.fetch(input, options)
  }

  return {
    fetch: pixivFetch,
    close() {
      // Called after task cancellation/drain. Destroy also releases an unread
      // response if an interrupted task could not finish its body cleanup.
      closing ??= Promise.all([
        ...Array.from(proxyAgents.values(), (agent) => agent.destroy()),
        ...(directAgent ? [directAgent.destroy()] : [])
      ]).then(() => undefined)
      return closing
    }
  }
}
