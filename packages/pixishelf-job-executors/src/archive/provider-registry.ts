import { ArchiveExecutorError } from './errors.js'
import { EHentaiProvider } from './providers/e-hentai.js'
import type { ArchiveMediaProvider, ArchiveMediaProviderRegistry } from './types.js'

export class DefaultArchiveMediaProviderRegistry implements ArchiveMediaProviderRegistry {
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
}

export function createDefaultArchiveMediaProviderRegistry(): ArchiveMediaProviderRegistry {
  return new DefaultArchiveMediaProviderRegistry([new EHentaiProvider()])
}
