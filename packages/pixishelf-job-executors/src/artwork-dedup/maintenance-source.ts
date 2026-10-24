import path from 'node:path'
import { z } from 'zod'
import { readStableFileContent } from '../scan/content-reader.ts'
import { ScanExecutorError } from '../scan/errors.ts'
import { parseMetadataDocument } from '../scan/metadata.ts'
import { createChapterManifestHash, parseChapterManifest } from '../video-processing/chapter-manifest.ts'
import {
  assertMediaContentRootUnchanged,
  canonicalMediaContentPath,
  MediaContentFileError,
  resolveMediaContentPath,
  type ResolvedMediaContentRoot
} from '../media-content/roots.ts'
import { sameContentFileState } from '../media-content/file-reader.ts'
import { inspectMaintenanceFile, type MaintenanceInspection } from './maintenance-files.ts'

const id = z.string().min(1).max(128)
const sha = z.string().regex(/^[a-f0-9]{64}$/)
export const maintenanceSourceIdentitySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('PIXIV_METADATA'),
      externalId: z.string().regex(/^\d+$/).max(128),
      format: z.enum(['json', 'txt'])
    })
    .strict(),
  z.object({ kind: z.literal('CHAPTER'), chaptersHash: sha }).strict(),
  z.object({ kind: z.literal('ARCHIVE_MANIFEST'), revisionId: id, providerKey: id, externalId: id }).strict()
])
export type MaintenanceSourceIdentity = z.infer<typeof maintenanceSourceIdentitySchema>
export const maintenanceSourceErrorCodes = [
  'SOURCE_TOO_LARGE',
  'SOURCE_IDENTITY_MISMATCH',
  'CHAPTER_IDENTITY_MISMATCH'
] as const
export class MaintenanceSourceError extends Error {
  constructor(readonly code: (typeof maintenanceSourceErrorCodes)[number]) {
    super(code)
    this.name = 'MaintenanceSourceError'
  }
}
const manifestMedia = z.object({
  index: z.number().int().nonnegative().safe(),
  path: z.string().min(1).max(8192),
  sha256: sha,
  bytes: z.string().regex(/^\d+$/).max(32)
})
const archiveManifest = z.object({
  revisionId: id,
  provider: z.object({ key: id, externalId: id }),
  media: z.array(manifestMedia)
})
export interface MaintenanceSourceResult extends MaintenanceInspection {
  sha256: string
  bytesRead: bigint
  media: Array<z.infer<typeof manifestMedia>>
  mediaCount: number
  nextOffset: number | null
}
export async function inspectMaintenanceSource(input: {
  root: ResolvedMediaContentRoot
  relativePath: string
  expectedIdentity: MaintenanceSourceIdentity
  offset: number
  signal: AbortSignal
  onProgress?: (bytesRead: bigint) => void | Promise<void>
}): Promise<MaintenanceSourceResult> {
  const expected = maintenanceSourceIdentitySchema.parse(input.expectedIdentity)
  if (
    !Number.isSafeInteger(input.offset) ||
    input.offset < 0 ||
    (expected.kind !== 'ARCHIVE_MANIFEST' && input.offset !== 0)
  )
    throw new MaintenanceSourceError('SOURCE_IDENTITY_MISMATCH')
  const before = await inspectMaintenanceFile(input)
  if (
    before.kind !== 'FILE' ||
    !before.state ||
    before.state.size <= 0n ||
    before.state.linkCount !== 1n ||
    before.state.deviceId !== input.root.deviceId
  )
    throw new MediaContentFileError('INVALID_FILE', 'INVALID_FILE')
  const maxBytes = expected.kind === 'CHAPTER' ? 5 * 1024 * 1024 : 16 * 1024 * 1024
  if (before.state.size > BigInt(maxBytes)) throw new MaintenanceSourceError('SOURCE_TOO_LARGE')
  const resolved = await resolveMediaContentPath(input.root, input.relativePath)
  let content
  try {
    content = await readStableFileContent({
      absolutePath: resolved.absolutePath,
      maxBytes,
      signal: input.signal,
      ...(input.onProgress ? { onProgress: input.onProgress } : {})
    })
  } catch (error) {
    if (error instanceof ScanExecutorError)
      throw new MediaContentFileError('FILE_CHANGED', 'FILE_CHANGED', { cause: error })
    throw error
  }
  const after = await inspectMaintenanceFile(input)
  if (
    !after.state ||
    !sameContentFileState(before.state, after.state) ||
    before.state.linkCount !== after.state.linkCount ||
    content.state.deviceId !== after.state.deviceId ||
    content.state.inode !== after.state.inode ||
    content.state.sizeBytes !== after.state.size
  )
    throw new MediaContentFileError('FILE_CHANGED', 'FILE_CHANGED')
  await assertMediaContentRootUnchanged(input.root)
  const result: MaintenanceSourceResult = {
    ...after,
    sha256: content.sha256,
    bytesRead: BigInt(content.size),
    media: [],
    mediaCount: 0,
    nextOffset: null
  }
  try {
    if (expected.kind === 'PIXIV_METADATA') {
      if (parseMetadataDocument(content.bytes.toString('utf8'), expected.format).id !== expected.externalId)
        throw new Error('Identity mismatch')
    } else if (expected.kind === 'CHAPTER') {
      if (
        !path.posix.basename(input.relativePath).toLowerCase().endsWith('.chapters.json') ||
        createChapterManifestHash(parseChapterManifest(JSON.parse(content.bytes.toString('utf8')))) !==
          expected.chaptersHash
      )
        throw new Error('Chapter identity mismatch')
    } else {
      const manifest = archiveManifest.parse(JSON.parse(content.bytes.toString('utf8')))
      if (
        manifest.revisionId !== expected.revisionId ||
        manifest.provider.key !== expected.providerKey ||
        manifest.provider.externalId !== expected.externalId ||
        input.offset > manifest.media.length
      )
        throw new Error('Manifest identity mismatch')
      const indexes = new Set<number>(),
        paths = new Set<string>()
      for (const row of manifest.media) {
        canonicalMediaContentPath(row.path)
        if (indexes.has(row.index) || paths.has(row.path)) throw new Error('Duplicate manifest reference')
        indexes.add(row.index)
        paths.add(row.path)
      }
      result.mediaCount = manifest.media.length
      result.media = manifest.media.slice(input.offset, input.offset + 100)
      result.nextOffset =
        input.offset + result.media.length < manifest.media.length ? input.offset + result.media.length : null
    }
  } catch {
    throw new MaintenanceSourceError(
      expected.kind === 'CHAPTER' ? 'CHAPTER_IDENTITY_MISMATCH' : 'SOURCE_IDENTITY_MISMATCH'
    )
  }
  return result
}
