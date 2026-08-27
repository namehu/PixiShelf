import * as fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

import {
  normalizePixivArtworkSeries,
  type NormalizedPixivArtworkSeries
} from '../pixiv-artwork/client.ts'

const MAX_SNAPSHOT_BYTES = 1_000_000

const normalizedSeriesSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('PRESENT'),
    id: z.string().regex(/^[1-9][0-9]*$/),
    title: z.string().nullable(),
    order: z.number().int().nonnegative().nullable()
  }),
  z.object({ state: z.literal('NONE') }),
  z.object({ state: z.literal('UNKNOWN') })
])

const snapshotSchema = z.object({
  fetchedAt: z.string().datetime(),
  raw: z.unknown(),
  normalized: z.object({ id: z.string().regex(/^[1-9][0-9]*$/), series: z.unknown().optional() }).passthrough()
})

export interface StoredPixivSeriesObservation {
  fetchedAt: Date
  series: NormalizedPixivArtworkSeries
}

export class PixivSeriesSnapshotReadError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message)
    this.name = 'PixivSeriesSnapshotReadError'
  }
}

export async function readPixivSeriesObservationFromSnapshot(input: {
  pixivDataRoot: string
  pixivArtworkId: string
  snapshotHash: string
  snapshotPath: string
}): Promise<StoredPixivSeriesObservation> {
  if (!/^[1-9][0-9]*$/.test(input.pixivArtworkId) || !/^[a-f0-9]{64}$/.test(input.snapshotHash)) {
    throw new PixivSeriesSnapshotReadError('Pixiv 作品快照身份无效', 'PIXIV_SERIES_SNAPSHOT_IDENTITY_INVALID')
  }
  const expectedPath = path.posix.join(
    'artworks',
    input.pixivArtworkId,
    'metadata',
    `${input.snapshotHash}.json`
  )
  if (input.snapshotPath !== expectedPath) {
    throw new PixivSeriesSnapshotReadError('Pixiv 作品快照路径与身份不一致', 'PIXIV_SERIES_SNAPSHOT_PATH_INVALID')
  }

  const root = path.resolve(input.pixivDataRoot)
  const segments = expectedPath.split('/')
  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (!stat) throw new PixivSeriesSnapshotReadError('Pixiv 作品快照不存在', 'PIXIV_SERIES_SNAPSHOT_MISSING')
    if (stat.isSymbolicLink()) {
      throw new PixivSeriesSnapshotReadError('Pixiv 作品快照路径包含符号链接', 'PIXIV_SERIES_SNAPSHOT_UNSAFE')
    }
  }
  const stat = await fs.stat(current)
  if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) {
    throw new PixivSeriesSnapshotReadError('Pixiv 作品快照不是可读取的普通文件', 'PIXIV_SERIES_SNAPSHOT_UNSAFE')
  }
  const relative = path.relative(root, current)
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new PixivSeriesSnapshotReadError('Pixiv 作品快照越过存储根目录', 'PIXIV_SERIES_SNAPSHOT_PATH_INVALID')
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(await fs.readFile(current, 'utf8'))
  } catch {
    throw new PixivSeriesSnapshotReadError('Pixiv 作品快照 JSON 已损坏', 'PIXIV_SERIES_SNAPSHOT_CORRUPT')
  }
  const snapshot = snapshotSchema.safeParse(parsedJson)
  if (!snapshot.success || snapshot.data.normalized.id !== input.pixivArtworkId) {
    throw new PixivSeriesSnapshotReadError('Pixiv 作品快照内容身份不一致', 'PIXIV_SERIES_SNAPSHOT_IDENTITY_INVALID')
  }

  const normalized = normalizedSeriesSchema.safeParse(snapshot.data.normalized.series)
  const series = normalized.success ? normalized.data : parseLegacyRawSeries(snapshot.data.raw)
  return { fetchedAt: new Date(snapshot.data.fetchedAt), series }
}

function parseLegacyRawSeries(raw: unknown): NormalizedPixivArtworkSeries {
  if (!raw || typeof raw !== 'object') return { state: 'UNKNOWN' }
  const body = (raw as Record<string, unknown>).body
  if (!body || typeof body !== 'object') return { state: 'UNKNOWN' }
  if (!Object.prototype.hasOwnProperty.call(body, 'seriesNavData')) return { state: 'UNKNOWN' }
  return normalizePixivArtworkSeries((body as Record<string, unknown>).seriesNavData)
}
