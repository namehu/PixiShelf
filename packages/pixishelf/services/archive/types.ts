import type { Readable } from 'node:stream'

export type ArchiveQualityValue = 'ORIGINAL' | 'DISPLAY'
export type ArchiveItemStatusFilter = 'ALL' | 'COMPLETED' | 'FAILED' | 'PENDING' | 'DOWNLOADING'

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

export interface ResolvedMedia {
  index: number
  sourcePageUrl: string
  locator: Record<string, unknown>
  expectedFilename: string
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
  media: ResolvedMedia[]
  normalizedMetadata: Record<string, unknown>
  rawMetadata: Record<string, unknown>
  warnings: string[]
  creatorBucket: string
}

export interface RemoteMedia {
  stream: Readable
  mimeType: string | null
  contentLength: number | null
  originalFilename: string | null
  quality: ArchiveQualityValue
  remoteHost: string | null
}

export interface ArchiveProviderContext {
  signal?: AbortSignal
}

export interface ArchiveDownloadContext extends ArchiveProviderContext {
  quality: ArchiveQualityValue
}

export interface ArchiveProvider {
  readonly key: string
  accepts(url: URL): boolean
  resolve(url: string, context?: ArchiveProviderContext): Promise<ResolvedArchive>
  openMedia(item: ResolvedMedia, context: ArchiveDownloadContext): Promise<RemoteMedia>
}

export type ArchiveTaskAction =
  | 'PAUSE'
  | 'RESUME'
  | 'CANCEL'
  | 'RETRY'
  | 'USE_DISPLAY_QUALITY'
  | 'DELETE_STAGING'
  | 'DELETE_ARCHIVE'
  | 'RESTORE_ARCHIVE'

export interface ArchivePreview {
  previewToken: string
  providerKey: string
  externalId: string
  canonicalUrl: string
  title: string
  titleAliases: string[]
  category: string | null
  uploader: string | null
  thumbnailUrl: string | null
  pageCount: number
  tags: SourceTagValue[]
  creatorBucket: string
  requestedQuality: ArchiveQualityValue
  existingArtworkId: number | null
  activeTaskId: string | null
  isUpdate: boolean
  warnings: string[]
}

export interface ConfirmedArchiveInput {
  previewToken: string
  quality: ArchiveQualityValue
}
