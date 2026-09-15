import { z } from 'zod'

export const ArtworkDeleteEntryStatusSchema = z.enum(['DELETED', 'MISSING', 'RETAINED', 'FAILED', 'NOT_ATTEMPTED'])
export const ArtworkDeleteReportSchema = z.object({
  reportId: z.string(),
  artwork: z.object({
    id: z.number().int(),
    title: z.string(),
    createdVia: z.string(),
    directory: z.string().nullable()
  }),
  startedAt: z.string(),
  finishedAt: z.string(),
  mode: z.enum(['DIRECT_DELETE', 'ARCHIVE_TRASH']),
  outcome: z.enum(['COMPLETED', 'PARTIAL', 'FAILED', 'QUEUED']),
  entries: z.array(
    z.object({
      path: z.string(),
      kind: z.enum(['MEDIA', 'CHAPTER', 'METADATA', 'DIRECTORY', 'OTHER']),
      status: ArtworkDeleteEntryStatusSchema,
      reason: z.string(),
      code: z.string().optional()
    })
  ),
  database: z.object({
    artwork: z.enum(['DELETED', 'RETAINED', 'FAILED', 'NOT_ATTEMPTED']),
    media: z.enum(['DELETED', 'RETAINED', 'FAILED', 'NOT_ATTEMPTED']),
    deletedMediaCount: z.number().int().nonnegative(),
    relatedRecords: z.array(z.string())
  }),
  counts: z.object({
    media: z.number().int().nonnegative(),
    sidecars: z.number().int().nonnegative(),
    directories: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    retained: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    notAttempted: z.number().int().nonnegative()
  }),
  inspectionComplete: z.boolean(),
  warnings: z.array(z.string()),
  archive: z.object({ jobId: z.string().nullable(), lifecycleState: z.string(), reused: z.boolean() }).nullable()
})

export type ArtworkDeleteReport = z.infer<typeof ArtworkDeleteReportSchema>
export type ArtworkDeleteEntry = ArtworkDeleteReport['entries'][number]

export const DELETE_STATUS_LABELS = {
  DELETED: '已删除',
  MISSING: '原本不存在',
  RETAINED: '已保留',
  FAILED: '失败',
  NOT_ATTEMPTED: '未执行'
} as const
export const DELETE_KIND_LABELS = {
  MEDIA: '媒体文件',
  CHAPTER: '章节文件',
  METADATA: '元数据',
  DIRECTORY: '目录',
  OTHER: '其他文件'
} as const
export const DELETE_OUTCOME_LABELS = {
  COMPLETED: '删除完成',
  PARTIAL: '部分完成',
  FAILED: '删除失败',
  QUEUED: '回收请求已提交'
} as const

/** Also used by the download: never derive totals from the candidate list or Image.imageCount. */
export function countArtworkDeleteEntries(entries: ArtworkDeleteEntry[]): ArtworkDeleteReport['counts'] {
  const counts = { media: 0, sidecars: 0, directories: 0, missing: 0, retained: 0, failed: 0, notAttempted: 0 }
  for (const entry of entries) {
    if (entry.status === 'DELETED') {
      if (entry.kind === 'MEDIA') counts.media++
      else if (entry.kind === 'DIRECTORY') counts.directories++
      else counts.sidecars++
    } else if (entry.status === 'MISSING') counts.missing++
    else if (entry.status === 'RETAINED') counts.retained++
    else if (entry.status === 'FAILED') counts.failed++
    else counts.notAttempted++
  }
  return counts
}

export function formatArtworkDeleteReport(report: ArtworkDeleteReport): string {
  // Quoted JSON strings preserve newlines/control characters in filenames without inventing report rows.
  const quote = (value: string) => JSON.stringify(value)
  return [
    'PixiShelf 删除总结',
    `报告：${report.reportId}`,
    `作品：${report.artwork.id} ${quote(report.artwork.title)}`,
    `创建方式：${report.artwork.createdVia}`,
    `作品目录：${quote(report.artwork.directory ?? '未确定')}`,
    `开始：${report.startedAt}　结束：${report.finishedAt}`,
    `结果：${DELETE_OUTCOME_LABELS[report.outcome]}`,
    `已删除媒体 ${report.counts.media}，附属文件 ${report.counts.sidecars}，目录 ${report.counts.directories}`,
    `原本不存在 ${report.counts.missing}，保留 ${report.counts.retained}，失败 ${report.counts.failed}，未执行 ${report.counts.notAttempted}`,
    `目录检查：${report.inspectionComplete ? '已完整检查本次作品目录' : '未完整检查目录内部'}`,
    '',
    '数据库结果',
    `作品记录：${DELETE_STATUS_LABELS[report.database.artwork]}`,
    `媒体记录：${DELETE_STATUS_LABELS[report.database.media]}，实际删除 ${report.database.deletedMediaCount} 条`,
    ...report.database.relatedRecords,
    '标签、艺术家和系列实体本身保留。',
    ...(report.archive
      ? [
          `归档状态：${report.archive.lifecycleState}；任务：${report.archive.jobId ?? '无新增任务'}；本次请求不执行文件移动或物理删除。`
        ]
      : []),
    '',
    '文件与目录明细（相对扫描根目录）',
    ...report.entries.map(
      (entry, index) =>
        `${index + 1}. [${DELETE_STATUS_LABELS[entry.status]}] [${DELETE_KIND_LABELS[entry.kind]}] ${quote(entry.path)} — ${quote(entry.reason)}${entry.code ? ` (${entry.code})` : ''}`
    ),
    '',
    '说明',
    ...report.warnings.map(quote),
    '本报告仅记录本次请求结果，不是备份；文件恢复依赖兼容的备份或快照。'
  ].join('\n')
}
