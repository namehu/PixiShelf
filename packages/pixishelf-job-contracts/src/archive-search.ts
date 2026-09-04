import { z } from 'zod'

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
    uploaderUid: z
      .string()
      .trim()
      .regex(/^\d{1,20}$/, '上传者 UID 必须是正整数')
      .refine((value) => BigInt(value) > 0n, '上传者 UID 必须是正整数')
      .transform((value) => BigInt(value).toString())
      .nullable()
      .default(null)
  })
  .strict()

export type ArchiveTitleQuery = z.infer<typeof archiveTitleQuerySchema>

export function archiveTitleSearchTerm(input: ArchiveTitleQuery): string {
  const query = archiveTitleQuerySchema.parse(input)
  return `title:"${normalizeArchiveTitle(query.keyword)}"${query.uploaderUid ? ` uploaduid:${query.uploaderUid}` : ''}`
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
