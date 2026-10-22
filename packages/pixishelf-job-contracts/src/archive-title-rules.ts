import { z } from 'zod'
import { decodeHTMLStrict } from 'entities'
import { normalizeArchiveUploaderName, type ArchiveTitleQuery } from './archive-search.ts'
import { compileArchiveTitleRegex } from './archive-title-regex.ts'

export const ARCHIVE_TITLE_RULE_OPERATORS = {
  CONTAINS: '包含',
  WHOLE_WORD: '完整词',
  STARTS_WITH: '开头是',
  ENDS_WITH: '结尾是',
  EQUALS: '整个标题相等',
  REGEX: '正则表达式'
} as const

export const archiveTitleConditionSchema = z
  .object({
    operator: z.enum(['CONTAINS', 'WHOLE_WORD', 'STARTS_WITH', 'ENDS_WITH', 'EQUALS', 'REGEX']),
    text: z.string().min(1, '请输入匹配文本').max(160, '匹配文本最多 160 个字符'),
    // Omitted by v1 records. Preserve their case-insensitive behavior.
    ignoreCase: z.boolean().optional()
  })
  .strict()
  .superRefine((condition, context) => {
    if (condition.operator !== 'REGEX') {
      if (!condition.text.trim()) context.addIssue({ code: 'custom', path: ['text'], message: '请输入匹配文本' })
      return
    }
    try {
      compileArchiveTitleRegex(condition.text, condition.ignoreCase !== false)
    } catch (error) {
      context.addIssue({ code: 'custom', path: ['text'], message: (error as Error).message })
    }
  })
  .transform((condition) => ({
    ...condition,
    text: condition.operator === 'REGEX' ? condition.text : condition.text.trim()
  }))

export const archiveTitleRulesSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    any: z.array(archiveTitleConditionSchema).min(1, '至少添加一个接纳条件').max(20),
    all: z.array(archiveTitleConditionSchema).max(20),
    none: z.array(archiveTitleConditionSchema).max(20)
  })
  .strict()
  .superRefine((rules, context) => {
    if (
      rules.version === 1 &&
      [...rules.any, ...rules.all, ...rules.none].some((row) => row.operator === 'REGEX' || row.ignoreCase === false)
    ) {
      context.addIssue({ code: 'custom', path: ['version'], message: '正则和区分大小写条件需要第 2 版规则' })
    }
  })

export const archiveTitleReviewDecisionSchema = z.enum(['AUTO', 'INCLUDE', 'EXCLUDE'])
export type ArchiveTitleRules = z.infer<typeof archiveTitleRulesSchema>
export type ArchiveTitleCondition = z.infer<typeof archiveTitleConditionSchema>
export type ArchiveTitleReviewDecision = z.infer<typeof archiveTitleReviewDecisionSchema>

export const archiveTitleEvidenceSchema = z
  .object({
    origin: z.enum(['REMOTE', 'HISTORICAL', 'MISSING']),
    // Raw provider titles retain whitespace. HTML entities are decoded exactly once by the matcher.
    titles: z.array(z.string()).max(20)
  })
  .strict()
export type ArchiveTitleEvidence = z.infer<typeof archiveTitleEvidenceSchema>

const archiveTitleMatchRangeSchema = z
  .object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() })
  .strict()
export type ArchiveTitleMatchRange = z.infer<typeof archiveTitleMatchRangeSchema>

export const archiveTitleEvaluationSchema = z
  .object({
    matched: z.boolean(),
    uploaderMatches: z.boolean(),
    reason: z.enum(['MATCHED', 'EXCLUDED', 'NO_MATCH', 'MISSING_TITLE', 'UPLOADER_MISMATCH']),
    titleIndex: z.number().int().nonnegative().nullable(),
    condition: archiveTitleConditionSchema.nullable(),
    // UTF-16 offsets into the decoded, untrimmed title. Optional for old evaluations.
    matchRanges: z.array(archiveTitleMatchRangeSchema).max(128).optional(),
    evidence: archiveTitleEvidenceSchema
  })
  .strict()
export type ArchiveTitleEvaluation = z.infer<typeof archiveTitleEvaluationSchema>

export const ARCHIVE_TITLE_REASON_LABELS = {
  MATCHED: '命中接纳条件',
  EXCLUDED: '命中排除条件',
  NO_MATCH: '未满足接纳条件',
  MISSING_TITLE: '缺少可用标题，等待人工复核',
  UPLOADER_MISMATCH: '不符合上传者限制'
} as const

export function legacyArchiveTitleRules(query: Pick<ArchiveTitleQuery, 'keyword' | 'matchMode'>): ArchiveTitleRules {
  return { version: 1, any: [{ operator: query.matchMode, text: query.keyword }], all: [], none: [] }
}

export function decodeArchiveTitle(value: string): string {
  return decodeHTMLStrict(value)
}

const normalized = (value: string) => value.trim().toLowerCase()
const wordCharacter = /[\p{L}\p{N}\p{M}_]/u

function conditionRanges(decoded: string, condition: ArchiveTitleCondition): ArchiveTitleMatchRange[] {
  const trimmed = decoded.trim()
  const offset = decoded.length - decoded.trimStart().length
  const ignoreCase = condition.ignoreCase !== false
  const ranges: ArchiveTitleMatchRange[] = []
  if (condition.operator === 'REGEX') {
    const matcher = compileArchiveTitleRegex(condition.text, ignoreCase).matcher(trimmed)
    while (ranges.length < 128 && matcher.find()) {
      ranges.push({ start: offset + matcher.start(), end: offset + matcher.end() })
    }
    return ranges
  }
  const title = ignoreCase ? trimmed.toLowerCase() : trimmed
  const needle = ignoreCase ? normalized(condition.text) : condition.text.trim()
  if (!needle) return ranges
  const constrained = ['EQUALS', 'STARTS_WITH', 'ENDS_WITH'].includes(condition.operator)
  let index = condition.operator === 'ENDS_WITH' ? title.length - needle.length : title.indexOf(needle)
  if (
    constrained &&
    !(condition.operator === 'EQUALS'
      ? title === needle
      : condition.operator === 'STARTS_WITH'
        ? title.startsWith(needle)
        : title.endsWith(needle))
  )
    return ranges
  while (index !== -1 && ranges.length < 128) {
    const end = index + needle.length
    const before = Array.from(title.slice(Math.max(0, index - 2), index)).at(-1)
    const after = Array.from(title.slice(end, end + 2))[0]
    const matches =
      condition.operator === 'CONTAINS' ||
      (condition.operator === 'EQUALS' && index === 0 && end === title.length) ||
      (condition.operator === 'STARTS_WITH' && index === 0) ||
      (condition.operator === 'ENDS_WITH' && end === title.length) ||
      (condition.operator === 'WHOLE_WORD' &&
        (!before || !wordCharacter.test(before)) &&
        (!after || !wordCharacter.test(after)))
    if (matches) ranges.push({ start: index, end })
    if (constrained) break
    index = title.indexOf(needle, index + 1)
  }
  // Lowercasing can expand a character (İ → i + combining dot). Map folded
  // offsets back to the original title so highlights never shift or split it.
  const starts: number[] = []
  const ends: number[] = []
  let original = offset
  for (const character of trimmed) {
    const folded = ignoreCase ? character.toLowerCase() : character
    for (let i = 0; i < folded.length; i++) {
      starts.push(original)
      ends.push(original + character.length)
    }
    original += character.length
  }
  return ranges.map(({ start, end }) => ({ start: starts[start]!, end: ends[end - 1]! }))
}

/** Reconstruct highlighting for older saved evaluations without re-evaluating current rules. */
export function archiveTitleConditionMatchRanges(
  rawTitle: string,
  condition: ArchiveTitleCondition
): ArchiveTitleMatchRange[] {
  const parsed = archiveTitleConditionSchema.safeParse(condition)
  return parsed.success ? conditionRanges(decodeArchiveTitle(rawTitle), parsed.data) : []
}

export function evaluateArchiveTitleRules(
  input: ArchiveTitleRules,
  evidence: ArchiveTitleEvidence,
  uploaderMatches = true
): ArchiveTitleEvaluation {
  const rules = archiveTitleRulesSchema.parse(input)
  const titles = evidence.titles.map(decodeArchiveTitle)
  const result = (
    reason: ArchiveTitleEvaluation['reason'],
    titleIndex: number | null = null,
    condition: ArchiveTitleCondition | null = null,
    matchRanges: ArchiveTitleMatchRange[] = []
  ): ArchiveTitleEvaluation => ({
    matched: reason === 'MATCHED',
    uploaderMatches,
    reason,
    titleIndex,
    condition,
    matchRanges,
    evidence
  })
  if (!uploaderMatches) return result('UPLOADER_MISMATCH')
  if (!titles.some((title) => title.trim())) return result('MISSING_TITLE')
  for (const [index, title] of titles.entries()) {
    if (!title.trim()) continue
    for (const condition of rules.none) {
      const ranges = conditionRanges(title, condition)
      if (ranges.length) return result('EXCLUDED', index, condition, ranges)
    }
  }
  for (const [index, title] of titles.entries()) {
    if (!title.trim()) continue
    const included = rules.any.find((condition) => conditionRanges(title, condition).length)
    if (!included) continue
    const required = rules.all.map((condition) => conditionRanges(title, condition))
    if (included && required.every((ranges) => ranges.length))
      return result('MATCHED', index, included, [...conditionRanges(title, included), ...required.flat()].slice(0, 128))
  }
  return result('NO_MATCH')
}

export function archiveTitleAccepted(
  evaluation: Pick<ArchiveTitleEvaluation, 'matched' | 'uploaderMatches'>,
  decision: ArchiveTitleReviewDecision
): boolean {
  return evaluation.uploaderMatches && (decision === 'INCLUDE' || (decision === 'AUTO' && evaluation.matched))
}

export function archiveTitleUploaderMatches(query: ArchiveTitleQuery, uploader: string | null | undefined): boolean {
  // UID restrictions are enforced by the remote query; gdata does not return uploader UIDs.
  return (
    !query.uploaderName ||
    normalizeArchiveUploaderName(uploader ?? '') === normalizeArchiveUploaderName(query.uploaderName)
  )
}

export function archiveTitleEvidenceFromCatalog(item: {
  matchTitles?: unknown
  comparisonSnapshot?: unknown
}): ArchiveTitleEvidence {
  const direct = archiveTitleEvidenceSchema.safeParse(item.matchTitles)
  if (direct.success) return direct.data
  const saved = z
    .object({ titles: z.object({ display: z.string(), aliases: z.array(z.string()).optional() }) })
    .safeParse(item.comparisonSnapshot)
  return saved.success
    ? { origin: 'HISTORICAL', titles: [saved.data.titles.display, ...(saved.data.titles.aliases ?? [])] }
    : { origin: 'MISSING', titles: [] }
}

export function canonicalArchiveTitleRules(rules: ArchiveTitleRules): ArchiveTitleRules {
  const group = (conditions: ArchiveTitleCondition[]) =>
    [
      ...new Map(
        conditions.map((condition) => {
          const canonical = {
            operator: condition.operator,
            text:
              condition.operator === 'REGEX'
                ? condition.text
                : condition.ignoreCase === false
                  ? condition.text.trim()
                  : normalized(condition.text),
            ...(condition.ignoreCase === false ? { ignoreCase: false } : {})
          }
          return [JSON.stringify(canonical), canonical] as const
        })
      ).values()
    ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))
  const parsed = archiveTitleRulesSchema.parse(rules)
  const version = [...parsed.any, ...parsed.all, ...parsed.none].some(
    (row) => row.operator === 'REGEX' || row.ignoreCase === false
  )
    ? 2
    : 1
  return { version, any: group(parsed.any), all: group(parsed.all), none: group(parsed.none) }
}

/** Preserve existing hashes for an equivalent legacy rule, including uploader identity normalization. */
export function archiveTitleQueryIdentity(query: ArchiveTitleQuery, rules: ArchiveTitleRules): string {
  const canonical = canonicalArchiveTitleRules(rules)
  const condition = canonical.any[0]!
  const simple =
    canonical.any.length === 1 &&
    !canonical.all.length &&
    !canonical.none.length &&
    condition.ignoreCase !== false &&
    ['CONTAINS', 'STARTS_WITH', 'ENDS_WITH'].includes(condition.operator) &&
    condition.text === normalized(query.keyword)
  const mode = simple ? condition.operator : canonical
  const base = ['e-hentai', normalized(query.keyword), mode]
  const single = query.uploaders?.length === 1 ? query.uploaders[0] : null
  return JSON.stringify(
    query.uploaders && !single
      ? [...base, query.uploaders.map(({ uid }) => uid)]
      : query.uploaderName
        ? [...base, null, normalizeArchiveUploaderName(query.uploaderName)]
        : [...base, single?.uid ?? query.uploaderUid]
  )
}

export const ARCHIVE_RULE_PREVIEW_JOB_TYPE = 'ARCHIVE_TITLE_RULE_PREVIEW' as const
export const ARCHIVE_RULE_PREVIEW_DEFINITION_VERSION = 2 as const
export const archiveTitleRulePreviewPayloadSchema = z.object({ revisionId: z.string().min(1).max(128) }).strict()
