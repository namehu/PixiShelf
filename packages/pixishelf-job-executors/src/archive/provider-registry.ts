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
        throw new Error(`Duplicate archive media provider: ${provider.key}`)
      }
      this.providers.set(provider.key, provider)
    }
  }

  get(providerKey: string): ArchiveMediaProvider {
    const provider = this.providers.get(providerKey)
    if (!provider) {
      throw new ArchiveExecutorError('UNSUPPORTED_PROVIDER', `Unsupported archive provider: ${providerKey}`)
    }
    return provider
  }

  getForUrl(input: string): ArchiveProvider {
    let url: URL
    try {
      url = new URL(input)
    } catch (error) {
      throw new ArchiveExecutorError('INVALID_URL', 'Archive URL is invalid', { cause: error })
    }
    if (url.username || url.password) {
      throw new ArchiveExecutorError('INVALID_URL', 'Archive URL must not contain credentials')
    }
    for (const provider of this.providers.values()) {
      if (isArchiveProvider(provider) && provider.accepts(url)) return provider
    }
    throw new ArchiveExecutorError('UNSUPPORTED_PROVIDER', 'No archive provider accepts this URL')
  }

  getUploaderScanner(providerKey: string): ArchiveUploaderProvider {
    const provider = this.get(providerKey)
    if (!isArchiveUploaderProvider(provider)) {
      throw new ArchiveExecutorError('UNSUPPORTED_PROVIDER', `Archive provider ${providerKey} cannot scan uploaders`)
    }
    return provider
  }
}

export function createDefaultArchiveMediaProviderRegistry(): ArchiveUploaderProviderRegistry {
  return new DefaultArchiveMediaProviderRegistry([new EHentaiProvider()])
}

function isArchiveUploaderProvider(provider: ArchiveMediaProvider): provider is ArchiveUploaderProvider {
  return isArchiveProvider(provider) && typeof (provider as Partial<ArchiveUploaderProvider>).scanUploader === 'function'
}

function isArchiveProvider(provider: ArchiveMediaProvider): provider is ArchiveProvider {
  const candidate = provider as Partial<ArchiveProvider>
  return (
    candidate.requestGovernance === 'PER_REQUEST' &&
    typeof candidate.accepts === 'function' &&
    typeof candidate.resolve === 'function'
  )
}
