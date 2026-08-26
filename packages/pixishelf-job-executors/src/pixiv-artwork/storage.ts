import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'

import type { PixivArtworkMetadataResponse } from './client.ts'

export interface StoredPixivArtworkSnapshot {
  hash: string
  relativePath: string
  reused: boolean
}

export class PixivArtworkSnapshotError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'PixivArtworkSnapshotError'
  }
}

export async function storePixivArtworkSnapshot(input: {
  pixivDataRoot: string
  pixivArtworkId: string
  fetchedAt: Date
  response: PixivArtworkMetadataResponse
}): Promise<StoredPixivArtworkSnapshot> {
  if (!/^[1-9][0-9]*$/.test(input.pixivArtworkId)) {
    throw new PixivArtworkSnapshotError('Pixiv 作品 ID 无效', 'PIXIV_SNAPSHOT_PATH_INVALID')
  }

  const content = {
    raw: input.response.raw,
    normalized: input.response.normalized
  }
  const hash = createHash('sha256').update(stableStringify(content)).digest('hex')
  const payload = { fetchedAt: input.fetchedAt.toISOString(), ...content }
  const bytes = Buffer.from(`${stableStringify(payload)}\n`, 'utf8')
  if (bytes.byteLength > 1_000_000) {
    throw new PixivArtworkSnapshotError('Pixiv 作品快照超过 1 MB 限制', 'PIXIV_SNAPSHOT_TOO_LARGE')
  }
  const relativePath = path.posix.join('artworks', input.pixivArtworkId, 'metadata', `${hash}.json`)
  const root = path.resolve(input.pixivDataRoot)
  const directory = path.resolve(root, 'artworks', input.pixivArtworkId, 'metadata')
  const destination = path.resolve(directory, `${hash}.json`)
  if (!isInside(root, directory) || path.dirname(destination) !== directory) {
    throw new PixivArtworkSnapshotError('Pixiv 作品快照存储路径无效', 'PIXIV_SNAPSHOT_PATH_INVALID')
  }

  await ensureSafeDirectory(root, ['artworks', input.pixivArtworkId, 'metadata'])
  const existing = await lstatOrNull(destination)
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new PixivArtworkSnapshotError('Pixiv 作品快照目标不是普通文件', 'PIXIV_SNAPSHOT_PATH_UNSAFE')
    }
    return { hash, relativePath, reused: true }
  }

  const temporary = path.join(directory, `.${hash}.${randomUUID()}.tmp`)
  await fs.writeFile(temporary, bytes, { flag: 'wx' })
  try {
    await fs.rename(temporary, destination)
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined)
    const concurrent = await lstatOrNull(destination)
    if (!concurrent?.isFile() || concurrent.isSymbolicLink()) throw error
    return { hash, relativePath, reused: true }
  }
  return { hash, relativePath, reused: false }
}

async function ensureSafeDirectory(root: string, segments: string[]) {
  await fs.mkdir(root, { recursive: true })
  const rootStat = await lstatOrNull(root)
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) {
    throw new PixivArtworkSnapshotError('pixiv_data 根目录不是安全目录', 'PIXIV_SNAPSHOT_PATH_UNSAFE')
  }
  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    const stat = await lstatOrNull(current)
    if (stat) {
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new PixivArtworkSnapshotError('Pixiv 作品快照目录包含符号链接', 'PIXIV_SNAPSHOT_PATH_UNSAFE')
      }
      continue
    }
    await fs.mkdir(current)
  }
}

async function lstatOrNull(filePath: string) {
  return fs.lstat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
}

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
