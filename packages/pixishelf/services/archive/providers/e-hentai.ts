import { ArchiveExecutorError, EHentaiProvider as SharedEHentaiProvider } from '@pixishelf/job-executors'
import { ArchiveError } from '../errors'
import type { ArchiveDownloadContext, ArchiveProviderContext, ResolvedMedia } from '../types'

export { chooseCreatorBucket, hashResolvedMetadata } from '@pixishelf/job-executors'

// Keep the Web error boundary while sharing all parsing, HTTP and recovery logic
// with the Worker. Router handlers rely on the local ArchiveError identity.
export class EHentaiProvider extends SharedEHentaiProvider {
  override async resolve(input: string, context: ArchiveProviderContext = {}) {
    try {
      return await super.resolve(input, context)
    } catch (error) {
      throw toWebArchiveError(error)
    }
  }

  override async openMedia(item: ResolvedMedia, context: ArchiveDownloadContext) {
    try {
      return await super.openMedia(item, context)
    } catch (error) {
      throw toWebArchiveError(error)
    }
  }
}

function toWebArchiveError(error: unknown) {
  if (!(error instanceof ArchiveExecutorError)) return error
  return new ArchiveError(error.code, error.message, {
    cause: error,
    recoverable: error.recoverable,
    pause: error.pause,
    retryAfterMs: error.retryAfterMs,
    decisionCode: error.decisionCode,
    stage: error.stage,
    remoteHost: error.remoteHost
  })
}
