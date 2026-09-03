import { ArchiveError } from './errors'
import type { ArchiveProvider } from './types'
import { EHentaiProvider } from './providers/e-hentai'

export class ArchiveProviderRegistry {
  constructor(private readonly providers: readonly ArchiveProvider[]) {}

  getForUrl(input: string): ArchiveProvider {
    let url: URL
    try {
      url = new URL(input)
    } catch (error) {
      throw new ArchiveError('INVALID_URL', '作品链接格式无效', { cause: error })
    }
    const provider = this.providers.find((candidate) => candidate.accepts(url))
    if (!provider) throw new ArchiveError('UNSUPPORTED_PROVIDER', '当前仅支持公开的 E-Hentai 作品链接')
    return provider
  }

  getByKey(key: string): ArchiveProvider {
    const provider = this.providers.find((candidate) => candidate.key === key)
    if (!provider) throw new ArchiveError('UNSUPPORTED_PROVIDER', `未注册的归档来源站点：${key}`)
    return provider
  }
}

export const archiveProviderRegistry = new ArchiveProviderRegistry([new EHentaiProvider()])
