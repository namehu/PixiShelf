import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { assertSafeFileName, resolveCreatablePathWithinRoot, resolveExistingPathWithinRoot } from '@/lib/safe-path'
import { ArchiveError, toArchiveError, withArchiveErrorContext } from './errors'
import type { RemoteMedia } from './types'

const DEFAULT_MAX_MEDIA_BYTES = 512 * 1024 * 1024

export interface ArchiveStoragePaths {
  stagingRelativePath: string
  stagingAbsolutePath: string
  finalRelativePath: string
  finalAbsolutePath: string
}

export interface ArchiveStorageRelativePaths {
  stagingRelativePath: string
  finalRelativePath: string
}

export interface StoredMediaResult {
  relativePath: string
  filename: string
  byteCount: bigint
  mimeType: string
  width: number
  height: number
  sha256: string
}

export function buildArchiveStoragePaths(input: {
  scanRoot: string
  importId: string
  providerKey: string
  creatorBucket: string
  externalId: string
}): ArchiveStoragePaths {
  const relativePaths = buildArchiveStorageRelativePaths(input)
  return {
    ...relativePaths,
    stagingAbsolutePath: path.resolve(input.scanRoot, relativePaths.stagingRelativePath),
    finalAbsolutePath: path.resolve(input.scanRoot, relativePaths.finalRelativePath)
  }
}

export function buildArchiveStorageRelativePaths(input: {
  importId: string
  providerKey: string
  creatorBucket: string
  externalId: string
}): ArchiveStorageRelativePaths {
  const provider = safePathSegment(input.providerKey)
  const bucket = safePathSegment(input.creatorBucket)
  const externalId = safePathSegment(input.externalId)
  const importId = safePathSegment(input.importId)
  const stagingRelativePath = normalizeRelativePath(path.join('.archive-staging', importId))
  // 每个已发布修订都有一个不可变的、按导入固定的目录。
  // 这使文件系统发布可重试：崩溃可能留下未被引用的待发布目录，但它永远不会替换当前已发布目录。
  const finalRelativePath = normalizeRelativePath(
    path.join('sources', provider, bucket, externalId, 'revisions', importId)
  )
  return {
    stagingRelativePath,
    finalRelativePath
  }
}

export async function prepareStagingDirectory(scanRoot: string, stagingRelativePath: string): Promise<string> {
  const target = await resolveCreatablePathWithinRoot(scanRoot, stagingRelativePath)
  try {
    await mkdir(path.join(target, 'media'), { recursive: true })
  } catch (error) {
    throw withStorageContext(error)
  }
  return target
}

export async function storeRemoteMedia(input: {
  remote: RemoteMedia
  stagingDirectory: string
  index: number
  expectedFilename: string
  signal?: AbortSignal
  maxBytes?: number
  partialKey?: string
  commitFile?: (paths: { partial: string; target: string }) => Promise<void>
}): Promise<StoredMediaResult> {
  const maxBytes = input.maxBytes ?? getConfiguredMaxMediaBytes()
  if (input.remote.contentLength !== null && input.remote.contentLength > maxBytes) {
    input.remote.stream.destroy()
    throw new ArchiveError('DOWNLOAD_TOO_LARGE', `媒体超过 ${maxBytes} 字节限制`, {
      stage: 'MEDIA_VALIDATION',
      remoteHost: input.remote.remoteHost
    })
  }
  const filename = buildStoredFilename(
    input.index,
    input.remote.originalFilename ?? input.expectedFilename,
    input.remote.mimeType
  )
  const mediaDirectory = path.join(input.stagingDirectory, 'media')
  const target = path.join(mediaDirectory, filename)
  const partialKey = safePathSegment(input.partialKey ?? 'default')
  const partial = `${target}.part-${partialKey}`
  let handle: Awaited<ReturnType<typeof open>>
  try {
    await mkdir(mediaDirectory, { recursive: true })
    await rm(partial, { force: true })
    handle = await open(partial, 'wx')
  } catch (error) {
    throw withStorageContext(error)
  }
  const hash = createHash('sha256')
  let byteCount = 0
  let transferError: ArchiveError | null = null
  try {
    for await (const chunk of input.remote.stream) {
      if (input.signal?.aborted) throw new ArchiveError('CANCELLED', '归档下载已取消', { recoverable: true })
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      byteCount += buffer.length
      if (byteCount > maxBytes) {
        throw new ArchiveError('DOWNLOAD_TOO_LARGE', `媒体超过 ${maxBytes} 字节限制`, {
          stage: 'MEDIA_STREAM',
          remoteHost: input.remote.remoteHost
        })
      }
      hash.update(buffer)
      try {
        await handle.write(buffer)
      } catch (error) {
        throw withStorageContext(error)
      }
    }
    try {
      await handle.sync()
    } catch (error) {
      throw withStorageContext(error)
    }
  } catch (error) {
    input.remote.stream.destroy()
    transferError = classifyMediaTransferError(error, input.remote.remoteHost)
  }
  try {
    await handle.close()
  } catch (error) {
    // close() 可能暴露延迟写入失败，如 ENOSPC/EIO。
    // 即使远端流也失败了，存储失败仍必须中止本任务。
    transferError = withStorageContext(error)
  }
  if (transferError) throw transferError

  if (input.remote.contentLength !== null && byteCount !== input.remote.contentLength) {
    await rm(partial, { force: true })
    throw new ArchiveError('MEDIA_INVALID', '媒体长度与远端 Content-Length 不一致', {
      recoverable: true,
      stage: 'MEDIA_VALIDATION',
      remoteHost: input.remote.remoteHost
    })
  }
  const mimeType = normalizeImageMimeType(input.remote.mimeType, filename)
  if (!mimeType.startsWith('image/')) {
    await rm(partial, { force: true })
    throw new ArchiveError('MEDIA_INVALID', `不支持的媒体类型: ${mimeType}`, {
      stage: 'MEDIA_VALIDATION',
      remoteHost: input.remote.remoteHost
    })
  }
  let metadata: sharp.Metadata
  try {
    metadata = await sharp(partial, { animated: true }).metadata()
  } catch (error) {
    await rm(partial, { force: true })
    throw new ArchiveError('MEDIA_INVALID', '下载内容不是可解码的图片', {
      cause: error,
      recoverable: true,
      stage: 'MEDIA_VALIDATION',
      remoteHost: input.remote.remoteHost
    })
  }
  if (!metadata.width || !metadata.height) {
    await rm(partial, { force: true })
    throw new ArchiveError('MEDIA_INVALID', '图片缺少有效尺寸', {
      recoverable: true,
      stage: 'MEDIA_VALIDATION',
      remoteHost: input.remote.remoteHost
    })
  }
  // 工作线程可能在原子改名后、持久化检查点前崩溃。
  // 此时该条目将按设计重新下载。
  if (input.commitFile) {
    await input.commitFile({ partial, target })
  } else {
    await rm(target, { force: true })
    await rename(partial, target)
  }
  return {
    relativePath: normalizeRelativePath(path.join('media', filename)),
    filename,
    byteCount: BigInt(byteCount),
    mimeType,
    width: metadata.width,
    height: metadata.pageHeight ?? metadata.height,
    sha256: hash.digest('hex')
  }
}

function withStorageContext(error: unknown): ArchiveError {
  const classified = toArchiveError(error)
  if (classified.code === 'STORAGE_FULL') return classified
  return withArchiveErrorContext(classified, { stage: 'STORAGE' })
}

function classifyMediaTransferError(error: unknown, remoteHost: string | null): ArchiveError {
  const classified = toArchiveError(error)
  if (classified.stage === 'STORAGE') return classified
  if (classified.code === 'INTERNAL') {
    return new ArchiveError('REMOTE_RESPONSE_INVALID', '远端媒体传输中断', {
      cause: classified,
      recoverable: true,
      stage: 'MEDIA_STREAM',
      remoteHost
    })
  }
  return classified.stage
    ? classified
    : withArchiveErrorContext(classified, {
        stage: 'MEDIA_STREAM',
        remoteHost
      })
}

export async function validateStoredMedia(
  stagingDirectory: string,
  items: Array<{ stagedPath: string | null; sha256: string | null; byteCount: bigint | null }>
): Promise<void> {
  for (const item of items) {
    if (!item.stagedPath || !item.sha256 || item.byteCount === null) {
      throw new ArchiveError('MEDIA_INVALID', '归档检查点缺少文件摘要')
    }
    const filePath = await resolveExistingPathWithinRoot(stagingDirectory, item.stagedPath)
    const file = await readFile(filePath)
    if (BigInt(file.length) !== item.byteCount || createHash('sha256').update(file).digest('hex') !== item.sha256) {
      throw new ArchiveError('MEDIA_INVALID', `归档文件校验失败: ${item.stagedPath}`, { recoverable: true })
    }
  }
}

export async function writeManifest(stagingDirectory: string, manifest: Record<string, unknown>): Promise<string> {
  const target = path.join(stagingDirectory, 'manifest.json')
  const temporary = `${target}.tmp`
  await writeFile(temporary, `${JSON.stringify(manifest, jsonReplacer, 2)}\n`, { encoding: 'utf8', flag: 'w' })
  JSON.parse(await readFile(temporary, 'utf8'))
  await rename(temporary, target)
  return 'manifest.json'
}

export async function removeArchivePath(scanRoot: string, relativePath: string): Promise<void> {
  const target = await resolveExistingPathWithinRoot(scanRoot, relativePath)
  const root = path.resolve(scanRoot)
  if (target === root) throw new ArchiveError('INTERNAL', '拒绝删除归档存储根目录')
  await rm(target, { recursive: true, force: true })
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '')
}

function buildStoredFilename(index: number, originalFilename: string, mimeType: string | null): string {
  const ordinal = String(index + 1).padStart(4, '0')
  const originalBase = path.basename(originalFilename.replace(/[\\/]/g, '-'))
  const parsed = path.parse(originalBase)
  const safeStem = safePathSegment(parsed.name || `media-${ordinal}`).slice(0, 160)
  const extension = safeExtension(parsed.ext) || extensionForMimeType(mimeType) || '.bin'
  return assertSafeFileName(`${ordinal}-${safeStem}${extension}`)
}

function safePathSegment(value: string): string {
  const safe = value
    .normalize('NFKC')
    .trim()
    // oxlint-disable-next-line no-control-regex -- 文件路径片段必须去除 C0 控制字符
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 180)
  if (!safe || safe === '.' || safe === '..') throw new ArchiveError('INTERNAL', '归档路径片段无效')
  return safe
}

function safeExtension(value: string): string {
  const normalized = value.toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(normalized) ? normalized : ''
}

function extensionForMimeType(mimeType: string | null): string {
  const type = mimeType?.split(';')[0]?.trim().toLowerCase()
  return (
    (
      {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/avif': '.avif',
        'image/bmp': '.bmp'
      } as Record<string, string>
    )[type ?? ''] ?? ''
  )
}

function normalizeImageMimeType(mimeType: string | null, filename: string): string {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase()
  if (normalized?.startsWith('image/')) return normalized
  const extension = path.extname(filename).toLowerCase()
  return (
    (
      {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.avif': 'image/avif',
        '.bmp': 'image/bmp'
      } as Record<string, string>
    )[extension] ?? 'application/octet-stream'
  )
}

function getConfiguredMaxMediaBytes(): number {
  const value = Number(process.env.ARCHIVE_MAX_MEDIA_BYTES)
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_MEDIA_BYTES
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value
}
