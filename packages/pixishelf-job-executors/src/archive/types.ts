import type { Readable } from 'node:stream'
import type { Prisma, PrismaClient } from '@pixishelf/db'
import type { ExecutionLogger } from '@pixishelf/job-runtime'

export type ArchiveQuality = 'ORIGINAL' | 'DISPLAY'

export interface SourceTagValue {
  namespace: string
  name: string
}

export interface SourceRelationshipValue {
  type: 'REPLACES'
  direction: 'OUTBOUND' | 'INBOUND'
  providerKey: string
  externalId: string
  canonicalUrl: string
  locator: Record<string, unknown>
}

export interface ArchiveMediaItem {
  id: string
  pageIndex: number
  sourcePageUrl: string
  locator: Prisma.JsonValue
  expectedFilename: string
  status: 'PENDING' | 'DOWNLOADING' | 'COMPLETED' | 'FAILED'
  attempts: number
  stagedPath: string | null
  byteCount: bigint | null
  mimeType: string | null
  quality: ArchiveQuality | null
  width: number | null
  height: number | null
  sha256: string | null
}

export interface ArchiveProviderMediaItem {
  index: number
  sourcePageUrl: string
  locator: Record<string, unknown>
  expectedFilename: string
}

export interface ArchiveRemoteMedia {
  stream: Readable
  mimeType: string | null
  contentLength: number | null
  originalFilename: string | null
  quality: ArchiveQuality
  remoteHost: string | null
}

export interface ResolvedArchive {
  providerKey: string
  externalId: string
  canonicalUrl: string
  locator: Record<string, unknown>
  title: string
  titleAliases: string[]
  description: string | null
  category: string | null
  uploader: string | null
  thumbnailUrl: string | null
  postedAt: Date | null
  tags: SourceTagValue[]
  relationships: SourceRelationshipValue[]
  media: ArchiveProviderMediaItem[]
  normalizedMetadata: Record<string, unknown>
  rawMetadata: Record<string, unknown>
  warnings: string[]
  creatorBucket: string
}

export interface ArchiveProviderContext {
  signal?: AbortSignal
  runResolveRequest?<T>(operation: () => Promise<T>): Promise<T>
}

export interface ArchiveDownloadContext extends ArchiveProviderContext {
  quality: ArchiveQuality
  maxConcurrentDownloads?: number
  runDownloadRequest?<T>(operation: () => Promise<T>): Promise<T>
  runDownloadStreamRequest?<T extends { stream: Readable }>(operation: () => Promise<T>): Promise<T>
}

export interface ArchiveMediaProvider {
  readonly key: string
  openMedia(item: ArchiveProviderMediaItem, context: ArchiveDownloadContext): Promise<ArchiveRemoteMedia>
}

export interface ArchiveProvider extends ArchiveMediaProvider {
  readonly requestGovernance: 'PER_REQUEST'
  accepts(url: URL): boolean
  resolve(url: string, context?: ArchiveProviderContext): Promise<ResolvedArchive>
  openMedia(item: ArchiveProviderMediaItem, context: ArchiveDownloadContext): Promise<ArchiveRemoteMedia>
}

export type ArchiveQualityValue = ArchiveQuality
export type ResolvedMedia = ArchiveProviderMediaItem
export type RemoteMedia = ArchiveRemoteMedia

export interface ArchiveMediaProviderRegistry {
  get(providerKey: string): ArchiveMediaProvider
}

export interface ArchiveProviderRegistry extends ArchiveMediaProviderRegistry {
  getForUrl(url: string): ArchiveProvider
}

export interface ArchiveExecutorConfig {
  scanRoot: string
  mediaConcurrency?: number
  maxMediaAttempts?: number
  maxMediaBytes?: number
}

export interface ArchiveExecutorDependencies {
  database: PrismaClient
  config: ArchiveExecutorConfig
  providers: ArchiveMediaProviderRegistry
  now?: () => Date
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  random?: () => number
  logger?: ExecutionLogger
}

export type ArchiveTransaction = Prisma.TransactionClient
