import path from 'node:path'
import { Prisma } from '@pixishelf/db'
import { IMAGE_FILE_EXTENSIONS, MEDIA_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS } from '@pixishelf/job-contracts'
import { hashStableFile, readStableFileContent } from './content-reader.js'
import { ScanExecutorError } from './errors.js'
import { buildLocalWorkContentFingerprint } from './fingerprint.js'
import { assertCanonicalRelativeScanPath, resolveSafeExistingPath, type SafeScanRoot } from './paths.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_DATABASE_INT = 2_147_483_647
const ARCHIVE_QUALITIES = new Set(['ORIGINAL', 'DISPLAY'])
const IMAGE_EXTENSIONS = new Set<string>(IMAGE_FILE_EXTENSIONS)
const VIDEO_EXTENSIONS = new Set<string>(VIDEO_FILE_EXTENSIONS)
const MEDIA_EXTENSIONS = new Set<string>(MEDIA_FILE_EXTENSIONS)
const PROVIDER_KEYS = new Set(['key', 'externalId', 'canonicalUrl', 'locator'])
const SNAPSHOT_KEYS = new Set(['metadataHash', 'normalized', 'raw'])
const MEDIA_KEYS = new Set([
  'index',
  'path',
  'originalFilename',
  'quality',
  'mimeType',
  'width',
  'height',
  'bytes',
  'sha256',
  'sourcePageUrl',
  'sourcePageLocator'
])
const MANIFEST_KEYS = new Set([
  'manifestVersion',
  'revisionId',
  'provider',
  'creatorBucket',
  'requestedQuality',
  'selectedQuality',
  'sourceSnapshot',
  'relationships',
  'media',
  'createdAt'
])

export interface FrozenArchiveManifest {
  revisionId: string | null
  creatorBucket: string | null
  requestedQuality: 'ORIGINAL' | 'DISPLAY' | null
  selectedQuality: 'ORIGINAL' | 'DISPLAY' | null
  provider: { key: string; externalId: string; canonicalUrl: string; locator: Record<string, unknown> }
  metadataHash: string
  normalized: Record<string, unknown>
  raw: Record<string, unknown>
  relationships: unknown[]
  createdAt: Date
  workFingerprint: string
  media: Array<{
    index: number
    databasePath: string
    width: number
    height: number
    bytes: bigint
    quality: 'ORIGINAL' | 'DISPLAY' | null
    mimeType: string | null
    originalFilename: string | null
    sourcePageUrl: string | null
    sourcePageLocator: Record<string, unknown> | null
    mediaType: 'IMAGE' | 'VIDEO'
  }>
}

export async function readAndVerifyArchiveManifest(input: {
  root: SafeScanRoot
  relativeDirectory: string
  signal: AbortSignal
  now: Date
  maxManifestBytes: number
  maxMediaItems: number
  maxMediaBytes: number
  maxJsonDepth: number
  maxPathDepth?: number
}): Promise<FrozenArchiveManifest> {
  const manifestPath = await resolveSafeExistingPath(input.root, `${input.relativeDirectory}/manifest.json`, 'file')
  const manifestContent = await readStableFileContent({
    absolutePath: manifestPath.absolutePath,
    maxBytes: input.maxManifestBytes,
    signal: input.signal
  })
  let raw: unknown
  try {
    raw = JSON.parse(manifestContent.bytes.toString('utf8'))
  } catch {
    throw new ScanExecutorError('METADATA_INVALID', 'Archive manifest is not valid JSON')
  }
  assertJsonBounds(raw, input.maxJsonDepth, Math.max(2_000, input.maxMediaItems * 40))
  const value = strictRecord(raw, MANIFEST_KEYS, 'Archive manifest')
  if (value.manifestVersion !== 1) {
    throw new ScanExecutorError('METADATA_INVALID', 'Archive manifest version is unsupported')
  }
  const provider = strictRecord(value.provider, PROVIDER_KEYS, 'Archive provider')
  const source = strictRecord(value.sourceSnapshot, SNAPSHOT_KEYS, 'Archive source snapshot')
  const key = text(provider.key, 50, 'provider key')
  const externalId = text(provider.externalId, 500, 'provider external id')
  const canonicalUrl = httpUrl(provider.canonicalUrl, 'provider URL')
  const locator = plainRecord(provider.locator, 'Archive provider locator')
  const metadataHash = sha256(source.metadataHash)
  const normalizedSource = plainRecord(source.normalized, 'Archive normalized metadata')
  const normalizedTags = normalizeTags(normalizedSource.tags)
  const normalized = normalizedTags === undefined ? normalizedSource : { ...normalizedSource, tags: normalizedTags }
  const sourceRaw = plainRecord(source.raw, 'Archive raw metadata')
  const relationships = validateRelationships(value.relationships ?? normalized.relationships)
  if (!Array.isArray(value.media) || value.media.length === 0 || value.media.length > input.maxMediaItems) {
    throw new ScanExecutorError('METADATA_INVALID', 'Archive media list exceeds the configured item limit')
  }

  const indexes = new Set<number>()
  const paths = new Set<string>()
  const media: FrozenArchiveManifest['media'] = []
  let totalBytes = 0n
  for (const itemValue of value.media) {
    const item = strictRecord(itemValue, MEDIA_KEYS, 'Archive media item')
    const itemPath = assertCanonicalRelativeScanPath(text(item.path, 1_000, 'media path'))
    if (itemPath.split('/').length > (input.maxPathDepth ?? input.maxJsonDepth)) {
      throw new ScanExecutorError('METADATA_INVALID', 'Archive media path exceeds the configured depth')
    }
    const extension = path.posix.extname(itemPath).toLowerCase()
    if (!MEDIA_EXTENSIONS.has(extension)) {
      throw new ScanExecutorError('METADATA_INVALID', 'Archive media path uses an unsupported extension')
    }
    const index = integer(item.index, 0, 'media index', MAX_DATABASE_INT)
    if (indexes.has(index) || paths.has(itemPath)) {
      throw new ScanExecutorError('METADATA_INVALID', 'Archive media index and path must be unique')
    }
    indexes.add(index)
    paths.add(itemPath)
    const width = integer(item.width, 1, 'media width', MAX_DATABASE_INT)
    const height = integer(item.height, 1, 'media height', MAX_DATABASE_INT)
    const quality = optionalQuality(item.quality, 'media quality')
    const mimeType = optionalText(item.mimeType, 120, 'media MIME type')
    const originalFilename = optionalText(item.originalFilename, 500, 'media original filename')
    const sourcePageUrl =
      item.sourcePageUrl === undefined || item.sourcePageUrl === null
        ? null
        : httpUrl(item.sourcePageUrl, 'media source page URL')
    const sourcePageLocator = optionalRecord(item.sourcePageLocator, 'Archive media source page locator')
    const expectedBytes = unsignedBigInt(item.bytes, 'media bytes')
    if (expectedBytes > BigInt(input.maxMediaBytes)) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Archive media exceeds the configured byte limit')
    }
    const expectedHash = sha256(item.sha256)
    const file = await resolveSafeExistingPath(input.root, `${input.relativeDirectory}/${itemPath}`, 'file')
    const content = await hashStableFile({
      absolutePath: file.absolutePath,
      maxBytes: input.maxMediaBytes,
      signal: input.signal
    })
    if (BigInt(content.size) !== expectedBytes || content.sha256 !== expectedHash) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Archive media does not match its manifest')
    }
    totalBytes += expectedBytes
    if (totalBytes > BigInt(input.maxMediaBytes)) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Archive media total exceeds the configured byte limit')
    }
    media.push({
      index,
      databasePath: file.relativePath,
      width,
      height,
      bytes: expectedBytes,
      quality,
      mimeType,
      originalFilename,
      sourcePageUrl,
      sourcePageLocator,
      mediaType: IMAGE_EXTENSIONS.has(extension)
        ? 'IMAGE'
        : VIDEO_EXTENSIONS.has(extension)
          ? 'VIDEO'
          : neverMediaType()
    })
  }
  media.sort((left, right) => left.index - right.index)
  const revisionId = value.revisionId === undefined ? null : text(value.revisionId, 255, 'revision id')
  const creatorBucket = optionalText(value.creatorBucket, 180, 'creator bucket')
  const requestedQuality = optionalQuality(value.requestedQuality, 'requested quality')
  const selectedQuality = optionalQuality(value.selectedQuality, 'selected quality')
  const createdAt = value.createdAt === undefined ? input.now : strictDate(value.createdAt)
  return {
    revisionId,
    creatorBucket,
    requestedQuality,
    selectedQuality,
    provider: { key, externalId, canonicalUrl, locator },
    metadataHash,
    normalized,
    raw: sourceRaw,
    relationships,
    createdAt,
    workFingerprint: buildLocalWorkContentFingerprint('ARCHIVE_MANIFEST', [
      { name: 'manifest.json', size: manifestContent.size, sha256: manifestContent.sha256 }
    ]),
    media
  }
}

export function archiveJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function strictRecord(value: unknown, allowedKeys: ReadonlySet<string>, label: string) {
  const result = plainRecord(value, label)
  for (const key of Object.keys(result)) {
    if (!allowedKeys.has(key)) throw new ScanExecutorError('METADATA_INVALID', `${label} contains an unknown field`)
  }
  return result
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ScanExecutorError('METADATA_INVALID', `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maximum) {
    throw new ScanExecutorError('METADATA_INVALID', `Archive ${label} is invalid`)
  }
  return value
}

function sha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new ScanExecutorError('METADATA_INVALID', 'Archive digest is invalid')
  }
  return value
}

function integer(value: unknown, minimum: number, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new ScanExecutorError('METADATA_INVALID', `Archive ${label} is invalid`)
  }
  return Number(value)
}

function unsignedBigInt(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new ScanExecutorError('METADATA_INVALID', `Archive ${label} is invalid`)
  }
  try {
    return BigInt(value)
  } catch {
    throw new ScanExecutorError('METADATA_INVALID', `Archive ${label} is invalid`)
  }
}

function strictDate(value: unknown) {
  if (typeof value !== 'string') throw new ScanExecutorError('METADATA_INVALID', 'Archive createdAt is invalid')
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new ScanExecutorError('METADATA_INVALID', 'Archive createdAt must be a canonical ISO timestamp')
  }
  return date
}

function normalizeTags(value: unknown) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 5_000) {
    throw new ScanExecutorError('METADATA_INVALID', 'Archive normalized tags are invalid')
  }
  const identities = new Set<string>()
  const tags: Array<{ namespace: string; name: string }> = []
  for (const tag of value) {
    const record = strictRecord(tag, new Set(['namespace', 'name']), 'Archive normalized tag')
    const namespace = text(record.namespace, 50, 'tag namespace')
    const name = text(record.name, 500, 'tag name')
    const identity = `${namespace}\0${name}`
    if (identities.has(identity)) continue
    identities.add(identity)
    tags.push({ namespace, name })
  }
  return tags
}

function validateRelationships(value: unknown) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 5_000) {
    throw new ScanExecutorError('METADATA_INVALID', 'Archive relationships are invalid')
  }
  const identities = new Set<string>()
  return value.map((item) => {
    const relationship = strictRecord(
      item,
      new Set(['type', 'direction', 'providerKey', 'externalId', 'canonicalUrl', 'locator']),
      'Archive relationship'
    )
    if (relationship.type !== 'REPLACES' || !['OUTBOUND', 'INBOUND'].includes(String(relationship.direction))) {
      throw new ScanExecutorError('METADATA_INVALID', 'Archive relationship type or direction is invalid')
    }
    const providerKey = text(relationship.providerKey, 50, 'relationship provider key')
    const externalId = text(relationship.externalId, 500, 'relationship external id')
    const identity = `${relationship.type}\0${relationship.direction}\0${providerKey}\0${externalId}`
    if (identities.has(identity)) {
      throw new ScanExecutorError('METADATA_INVALID', 'Archive relationships must be unique')
    }
    identities.add(identity)
    if (relationship.canonicalUrl !== undefined) {
      httpUrl(relationship.canonicalUrl, 'relationship URL')
    }
    if (relationship.locator !== undefined) {
      plainRecord(relationship.locator, 'Archive relationship locator')
    }
    return relationship
  })
}

function optionalText(value: unknown, maximum: number, label: string) {
  if (value === undefined || value === null) return null
  return text(value, maximum, label)
}

function optionalQuality(value: unknown, label: string): 'ORIGINAL' | 'DISPLAY' | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !ARCHIVE_QUALITIES.has(value)) {
    throw new ScanExecutorError('METADATA_INVALID', `Archive ${label} is invalid`)
  }
  return value as 'ORIGINAL' | 'DISPLAY'
}

function optionalRecord(value: unknown, label: string) {
  if (value === undefined || value === null) return null
  return plainRecord(value, label)
}

function httpUrl(value: unknown, label: string) {
  const candidate = text(value, 2_000, label)
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Unsupported protocol')
  } catch {
    throw new ScanExecutorError('METADATA_INVALID', `Archive ${label} is invalid`)
  }
  return candidate
}

function neverMediaType(): never {
  throw new ScanExecutorError('METADATA_INVALID', 'Archive media extension cannot be classified')
}

function assertJsonBounds(value: unknown, maxDepth: number, maxNodes: number) {
  const stack = [{ value, depth: 0 }]
  let nodes = 0
  while (stack.length > 0) {
    const current = stack.pop()!
    nodes += 1
    if (nodes > maxNodes || current.depth > maxDepth) {
      throw new ScanExecutorError('METADATA_INVALID', 'Archive manifest JSON exceeds configured structural limits')
    }
    if (!current.value || typeof current.value !== 'object') continue
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>)
    for (const child of children) stack.push({ value: child, depth: current.depth + 1 })
  }
}
