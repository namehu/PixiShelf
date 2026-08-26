import 'server-only'

import * as fs from 'node:fs/promises'
import path from 'node:path'

import {
  PIXIV_ARTWORK_SYNC_REPORT_MAX_BYTES,
  pixivArtworkEnrichmentPayloadSchema,
  pixivArtworkSyncReportSchema,
  type PixivArtworkSyncReport
} from '@pixishelf/job-contracts'
import type { PrismaClient } from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import { resolveExistingPathWithinRoot, UnsafePathError } from '@/lib/safe-path'
import { PIXIV_DATA_STORAGE_ROOT } from '@/services/pixiv-data-storage-paths'

const JOB_TYPE = 'PIXIV_ARTWORK_ENRICHMENT'
const REPORT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const SNAPSHOT_MAX_BYTES = 1_000_000

export class PixivArtworkSyncReportReadError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID' | 'UNAVAILABLE',
    message: string
  ) {
    super(message)
    this.name = 'PixivArtworkSyncReportReadError'
  }
}

export async function listPixivArtworkSyncReports(
  input: { artworkId: number; cursor?: string; limit?: number },
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const identity = await resolveIdentity(input.artworkId, database)
  const reports = await readReportDirectory(identity.pixivArtworkId)
  const validJobIds = await findValidReportJobIds(reports, identity, database)
  const validReports = reports
    .filter((report) => validJobIds.has(report.jobId))
    .sort((left, right) => right.checkedAt.localeCompare(left.checkedAt) || right.jobId.localeCompare(left.jobId))
  const limit = Math.min(50, Math.max(1, input.limit ?? 20))
  const cursorIndex = input.cursor ? validReports.findIndex((report) => report.jobId === input.cursor) : -1
  if (input.cursor && cursorIndex < 0) {
    throw new PixivArtworkSyncReportReadError('INVALID', '同步报告分页位置已经失效')
  }
  const start = cursorIndex + 1
  const page = validReports.slice(start, start + limit)
  return {
    artwork: { id: identity.artworkId, title: identity.title, pixivArtworkId: identity.pixivArtworkId },
    items: page.map(toReportSummary),
    nextCursor: start + page.length < validReports.length ? page.at(-1)?.jobId ?? null : null,
    total: validReports.length
  }
}

export async function getPixivArtworkSyncReport(
  input: { artworkId: number; reportId: string },
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const identity = await resolveIdentity(input.artworkId, database)
  const report = await readReport(identity.pixivArtworkId, input.reportId)
  assertReportIdentity(report, identity)
  if (!(await isValidReportJob(report, identity, database))) {
    throw new PixivArtworkSyncReportReadError('NOT_FOUND', '同步报告对应的任务不存在或未完成')
  }
  return report
}

export async function getPixivArtworkSyncSnapshot(
  input: { artworkId: number; reportId: string; side: 'before' | 'after' },
  database: PrismaClient = prisma as unknown as PrismaClient
) {
  const report = await getPixivArtworkSyncReport(input, database)
  const snapshot = report.snapshots[input.side]
  if (!snapshot) return { available: false as const, reason: 'NO_PREVIOUS_SNAPSHOT' as const }
  const expectedPath = path.posix.join(
    'artworks',
    report.pixivArtworkId,
    'metadata',
    `${snapshot.hash}.json`
  )
  if (snapshot.path !== expectedPath) {
    throw new PixivArtworkSyncReportReadError('INVALID', '同步报告中的快照路径不符合当前作品身份')
  }
  try {
    const content = await readJsonFile(snapshot.path, SNAPSHOT_MAX_BYTES)
    return { available: true as const, hash: snapshot.hash, path: snapshot.path, content }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { available: false as const, reason: 'SNAPSHOT_MISSING' as const }
    }
    throw normalizeReadError(error, '作品快照无法读取')
  }
}

async function resolveIdentity(artworkId: number, database: PrismaClient) {
  const artwork = await database.artwork.findUnique({
    where: { id: artworkId },
    select: {
      id: true,
      title: true,
      deletedAt: true,
      externalRefs: {
        where: { providerKey: 'pixiv' },
        select: { id: true, externalId: true },
        take: 2
      }
    }
  })
  const ref = artwork?.externalRefs[0]
  if (
    !artwork ||
    artwork.deletedAt ||
    artwork.externalRefs.length !== 1 ||
    !ref ||
    !/^[1-9][0-9]*$/.test(ref.externalId)
  ) {
    throw new PixivArtworkSyncReportReadError('NOT_FOUND', '作品没有唯一且有效的 Pixiv 身份')
  }
  return {
    artworkId: artwork.id,
    title: artwork.title,
    externalRefId: ref.id,
    pixivArtworkId: ref.externalId
  }
}

type PixivIdentity = Awaited<ReturnType<typeof resolveIdentity>>

async function readReportDirectory(pixivArtworkId: string) {
  const relativeDirectory = path.posix.join('artworks', pixivArtworkId, 'sync-reports')
  let directory: string
  try {
    directory = await resolveSafeExistingPath(relativeDirectory, 'directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw normalizeReadError(error, '同步报告目录无法读取')
  }
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const reports: PixivArtworkSyncReport[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const reportId = entry.name.slice(0, -'.json'.length)
    if (!REPORT_ID_PATTERN.test(reportId)) continue
    try {
      reports.push(await readReport(pixivArtworkId, reportId))
    } catch {
      // A damaged, partial or unrelated file is not valid report history.
    }
  }
  return reports
}

async function readReport(pixivArtworkId: string, reportId: string) {
  if (!REPORT_ID_PATTERN.test(reportId)) {
    throw new PixivArtworkSyncReportReadError('INVALID', '同步报告 ID 无效')
  }
  const relativePath = path.posix.join('artworks', pixivArtworkId, 'sync-reports', `${reportId}.json`)
  try {
    return pixivArtworkSyncReportSchema.parse(await readJsonFile(relativePath, PIXIV_ARTWORK_SYNC_REPORT_MAX_BYTES))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new PixivArtworkSyncReportReadError('NOT_FOUND', '同步报告不存在')
    }
    throw normalizeReadError(error, '同步报告内容无效')
  }
}

async function readJsonFile(relativePath: string, maxBytes: number): Promise<unknown> {
  const filePath = await resolveSafeExistingPath(relativePath, 'file')
  const stats = await fs.stat(filePath)
  if (!stats.isFile()) throw new PixivArtworkSyncReportReadError('INVALID', '目标不是普通文件')
  if (stats.size > maxBytes) throw new PixivArtworkSyncReportReadError('INVALID', 'JSON 文件超过读取限制')
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function resolveSafeExistingPath(relativePath: string, expected: 'file' | 'directory') {
  const segments = relativePath.split('/').filter(Boolean)
  let current = PIXIV_DATA_STORAGE_ROOT
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || /[\\/]/.test(segment)) {
      throw new PixivArtworkSyncReportReadError('INVALID', 'Pixiv data 路径无效')
    }
    current = path.join(current, segment)
    const stats = await fs.lstat(current)
    if (stats.isSymbolicLink()) throw new UnsafePathError('Pixiv data path contains a symbolic link')
  }
  const resolved = await resolveExistingPathWithinRoot(PIXIV_DATA_STORAGE_ROOT, relativePath)
  const stats = await fs.stat(resolved)
  if ((expected === 'file' && !stats.isFile()) || (expected === 'directory' && !stats.isDirectory())) {
    throw new PixivArtworkSyncReportReadError('INVALID', 'Pixiv data 路径类型不匹配')
  }
  return resolved
}

async function findValidReportJobIds(
  reports: PixivArtworkSyncReport[],
  identity: PixivIdentity,
  database: PrismaClient
) {
  const candidates = reports.filter((report) => matchesReportIdentity(report, identity))
  const valid = new Set<string>()
  for (let offset = 0; offset < candidates.length; offset += 500) {
    const chunk = candidates.slice(offset, offset + 500)
    const jobs = await database.systemJob.findMany({
      where: { id: { in: chunk.map((report) => report.jobId) }, type: JOB_TYPE, status: 'COMPLETED' },
      select: { id: true, payload: true }
    })
    for (const job of jobs) {
      const report = chunk.find((candidate) => candidate.jobId === job.id)
      if (report && matchesJobPayload(job.payload, report)) valid.add(job.id)
    }
  }
  return valid
}

async function isValidReportJob(report: PixivArtworkSyncReport, identity: PixivIdentity, database: PrismaClient) {
  assertReportIdentity(report, identity)
  const job = await database.systemJob.findFirst({
    where: { id: report.jobId, type: JOB_TYPE, status: 'COMPLETED' },
    select: { payload: true }
  })
  return Boolean(job && matchesJobPayload(job.payload, report))
}

function matchesJobPayload(payload: unknown, report: PixivArtworkSyncReport) {
  const parsed = pixivArtworkEnrichmentPayloadSchema.safeParse(payload)
  return (
    parsed.success &&
    parsed.data.mode === 'ARTWORK' &&
    parsed.data.artworkId === report.artworkId &&
    parsed.data.expectedExternalRefId === report.externalRefId &&
    parsed.data.expectedPixivArtworkId === report.pixivArtworkId
  )
}

function assertReportIdentity(report: PixivArtworkSyncReport, identity: PixivIdentity) {
  if (!matchesReportIdentity(report, identity)) {
    throw new PixivArtworkSyncReportReadError('NOT_FOUND', '同步报告不属于当前作品的 Pixiv 身份')
  }
}

function matchesReportIdentity(report: PixivArtworkSyncReport, identity: PixivIdentity) {
  return (
    report.artworkId === identity.artworkId &&
    report.externalRefId === identity.externalRefId &&
    report.pixivArtworkId === identity.pixivArtworkId
  )
}

function toReportSummary(report: PixivArtworkSyncReport) {
  return {
    id: report.jobId,
    checkedAt: report.checkedAt,
    status: report.status,
    changeKind: report.changeKind,
    refreshExisting: report.refreshExisting,
    fieldCount: report.fields.length,
    addedTagCount: report.tags.added.length,
    removedTagCount: report.tags.removed.length,
    protectedFieldCount: report.protectedFields.length,
    snapshotChanged: report.snapshots.changed
  }
}

function normalizeReadError(error: unknown, fallback: string) {
  if (error instanceof PixivArtworkSyncReportReadError) return error
  if (error instanceof UnsafePathError) return new PixivArtworkSyncReportReadError('INVALID', 'Pixiv data 路径不安全')
  if (error instanceof SyntaxError) return new PixivArtworkSyncReportReadError('INVALID', 'JSON 文件无法解析')
  return error instanceof Error ? error : new PixivArtworkSyncReportReadError('UNAVAILABLE', fallback)
}
