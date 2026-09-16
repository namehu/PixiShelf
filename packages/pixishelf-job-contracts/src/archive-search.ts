import { z } from 'zod'

export const ARCHIVE_SEARCH_DEFINITION_VERSION = 3 as const
export const MAX_ARCHIVE_TITLE_UPLOADERS = 10

const uploaderUidSchema = z
  .string()
  .trim()
  .regex(/^\d{1,20}$/, '上传者 UID 必须是正整数')
  .refine((value) => /^\d{1,20}$/.test(value) && BigInt(value) > 0n, '上传者 UID 必须是正整数')
  .transform((value) => BigInt(value).toString())
export const archiveTitleUploaderSchema = z
  .object({
    uid: uploaderUidSchema,
    displayName: z.string().trim().min(1).max(180).optional()
  })
  .strict()
export type ArchiveTitleUploader = z.infer<typeof archiveTitleUploaderSchema>

export function normalizeArchiveTitleUploaders(uploaders: readonly ArchiveTitleUploader[]): ArchiveTitleUploader[] {
  const unique = new Map<string, ArchiveTitleUploader>()
  for (const input of uploaders) {
    const uploader = archiveTitleUploaderSchema.parse(input)
    const previous = unique.get(uploader.uid)
    if (!previous || (!previous.displayName && uploader.displayName)) unique.set(uploader.uid, uploader)
  }
  return [...unique.values()].sort((left, right) => (BigInt(left.uid) < BigInt(right.uid) ? -1 : 1))
}

export const archiveUploaderNameSchema = z
  .string()
  .transform((value) => value.normalize('NFKC').trim())
  .pipe(
    z
      .string()
      .min(1, '请输入完整上传者名称')
      .max(180, '上传者名称最多 180 个字符')
      // oxlint-disable-next-line no-control-regex -- prevent injecting remote search syntax
      .refine((value) => !/["\u0000-\u001f\u007f]/.test(value), '上传者名称不能包含双引号或控制字符')
  )

export function normalizeArchiveUploaderName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
}

export const archiveTitleMatchModeSchema = z.enum(['CONTAINS', 'STARTS_WITH', 'ENDS_WITH'])
export const ARCHIVE_TITLE_MATCH_LABELS = {
  CONTAINS: '包含',
  STARTS_WITH: '开头是',
  ENDS_WITH: '结尾是'
} as const

export function normalizeArchiveTitle(value: string): string {
  return value.trim().toLowerCase()
}

// E-Hentai has no literal escape for these operators inside a quoted term.
// Reject ambiguous search syntax rather than silently changing the user's text.
const keywordSchema = z
  .string()
  .trim()
  .min(1, '请输入关键词')
  .max(160, '关键词最多 160 个字符')
  .refine(
    // oxlint-disable-next-line no-control-regex -- reject remote query control characters
    (value) => !/["*_％%\u0000-\u001f\u007f]/.test(value) && /[\p{L}\p{N}]/u.test(value),
    '关键词须包含文字或数字，且不能包含双引号、星号、下划线、百分号或控制字符'
  )

export const archiveTitleQuerySchema = z
  .object({
    keyword: keywordSchema,
    matchMode: archiveTitleMatchModeSchema.default('CONTAINS'),
    uploaderUid: uploaderUidSchema.nullable().default(null),
    uploaderName: archiveUploaderNameSchema.optional(),
    uploaderDisplayName: z.string().trim().min(1).max(180).optional(),
    uploaders: z
      .array(archiveTitleUploaderSchema)
      .min(1)
      .max(MAX_ARCHIVE_TITLE_UPLOADERS, '最多限定 10 个上传者')
      .transform(normalizeArchiveTitleUploaders)
      .optional()
  })
  .strict()
  .refine((query) => !(query.uploaderUid && query.uploaderName), '上传者名称条件与 UID 条件不能同时填写')
  .refine((query) => !query.uploaderDisplayName || Boolean(query.uploaderUid), '上传者展示名称需要对应 UID')
  .refine(
    (query) => !query.uploaders || !(query.uploaderUid || query.uploaderName || query.uploaderDisplayName),
    '不能同时填写单个上传者和上传者列表'
  )
  .refine(
    (query) => !query.uploaders || buildTitleSearchTerm(query).length <= 200,
    '搜索条件过长，请减少上传者数量或缩短关键词（原站最多 200 字符）'
  )

export type ArchiveTitleQuery = z.infer<typeof archiveTitleQuerySchema>

export function archiveTitleSearchTerm(input: ArchiveTitleQuery): string {
  const query = archiveTitleQuerySchema.parse(input)
  return buildTitleSearchTerm(query)
}

function buildTitleSearchTerm(query: {
  keyword: string
  uploaderUid: string | null
  uploaderName?: string | undefined
  uploaders?: ArchiveTitleUploader[] | undefined
}): string {
  if (query.uploaders) {
    const prefix = query.uploaders.length > 1 ? '~' : ''
    return `title:"${normalizeArchiveTitle(query.keyword)}" ${query.uploaders.map(({ uid }) => `${prefix}uploaduid:${uid}`).join(' ')}`
  }
  const uploader = query.uploaderUid
    ? ` uploaduid:${query.uploaderUid}`
    : query.uploaderName
      ? ` uploader:"${normalizeArchiveUploaderName(query.uploaderName)}"`
      : ''
  return `title:"${normalizeArchiveTitle(query.keyword)}"${uploader}`
}

export function archiveTitleUploaderLabel(query: ArchiveTitleQuery): string {
  if (query.uploaders) return query.uploaders.map(({ uid, displayName }) => displayName ?? `UID ${uid}`).join('、')
  return (
    query.uploaderName ?? query.uploaderDisplayName ?? (query.uploaderUid ? `UID ${query.uploaderUid}` : '不限上传者')
  )
}

export function matchesArchiveTitle(query: ArchiveTitleQuery, titles: readonly string[]): boolean {
  const keyword = normalizeArchiveTitle(query.keyword)
  if (!keyword) return false
  return titles.some((value) => {
    const title = normalizeArchiveTitle(value)
    if (query.matchMode === 'STARTS_WITH') return title.startsWith(keyword)
    if (query.matchMode === 'ENDS_WITH') return title.endsWith(keyword)
    return title.includes(keyword)
  })
}

export const archiveSearchScanPayloadSchema = z.object({ scanRunId: z.string().min(1).max(128) }).strict()
