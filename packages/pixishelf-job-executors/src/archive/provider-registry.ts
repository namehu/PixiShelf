import { ArchiveExecutorError } from './errors.ts'
import { EHentaiProvider } from './providers/e-hentai.ts'
import type {
  ArchiveMediaProvider,
  ArchiveProvider,
  ArchiveUploaderProvider,
  ArchiveUploaderProviderRegistry
} from './types.ts'

export class DefaultArchiveMediaProviderRegistry implements ArchiveUploaderProviderRegistry {
  private readonly providers = new Map<string, ArchiveMediaProvider>()

  constructor(providers: readonly ArchiveMediaProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.key)) {
        throw new Error(`归档媒体来源站点重复：${provider.key}`)
      }
      this.providers.set(provider.key, provider)
    }
  }

  get(providerKey: string): ArchiveMediaProvider {
    const provider = this.providers.get(providerKey)
    if (!provider) {
      throw new ArchiveExecutorError('UNSUPPORTED_PROVIDER', `不支持的归档来源站点：${providerKey}`)
    }
    return provider
  }

  getForUrl(input: string): ArchiveProvider {
    let url: URL
    try {
      url = new URL(input)
    } catch (error) {
      throw new ArchiveExecutorError('INVALID_URL', '归档链接格式无效', { cause: error })
    }
    if (url.username || url.password) {
      throw new ArchiveExecutorError('INVALID_URL', '归档链接不能包含账号或密码')
    }
    for (const provider of this.providers.values()) {
      if (isArchiveProvider(provider) && provider.accepts(url)) return provider
    }
    throw new ArchiveExecutorError('UNSUPPORTED_PROVIDER', '没有归档来源站点支持此链接')
  }

  getUploaderScanner(providerKey: string): ArchiveUploaderProvider {
    const provider = this.get(providerKey)
    if (!isArchiveUploaderProvider(provider)) {
      throw new ArchiveExecutorError('UNSUPPORTED_PROVIDER', `归档来源站点 ${providerKey} 不支持扫描上传者`)
    }
    return provider
  }
}

export function createDefaultArchiveMediaProviderRegistry(): ArchiveUploaderProviderRegistry {
  return new DefaultArchiveMediaProviderRegistry([new EHentaiProvider()])
}

function isArchiveUploaderProvider(provider: ArchiveMediaProvider): provider is ArchiveUploaderProvider {
  return (
    isArchiveProvider(provider) && typeof (provider as Partial<ArchiveUploaderProvider>).scanUploader === 'function'
  )
}

function isArchiveProvider(provider: ArchiveMediaProvider): provider is ArchiveProvider {
  const candidate = provider as Partial<ArchiveProvider>
  return (
    candidate.requestGovernance === 'PER_REQUEST' &&
    typeof candidate.accepts === 'function' &&
    typeof candidate.resolve === 'function'
  )
}
