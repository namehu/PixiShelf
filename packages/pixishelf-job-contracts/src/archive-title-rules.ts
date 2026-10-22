import { z } from 'zod'
import { decodeHTMLStrict } from 'entities'
import { normalizeArchiveUploaderName, type ArchiveTitleQuery } from './archive-search.ts'

export const ARCHIVE_TITLE_RULE_OPERATORS = {
  CONTAINS: '包含',
  WHOLE_WORD: '完整词',
  STARTS_WITH: '开头是',
  ENDS_WITH: '结尾是',
  EQUALS: '整个标题相等'
} as const

export const archiveTitleConditionSchema = z
  .object({
    operator: z.enum(['CONTAINS', 'WHOLE_WORD', 'STARTS_WITH', 'ENDS_WITH', 'EQUALS']),
    text: z.string().trim().min(1, '请输入匹配文本').max(160, '匹配文本最多 160 个字符')
  })
  .strict()

export const archiveTitleRulesSchema = z
  .object({
    version: z.literal(1),
    any: z.array(archiveTitleConditionSchema).min(1, '至少添加一个接纳条件').max(20),
    all: z.array(archiveTitleConditionSchema).max(20),
    none: z.array(archiveTitleConditionSchema).max(20)
  })
  .strict()

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

export const archiveTitleEvaluationSchema = z
  .object({
    matched: z.boolean(),
    uploaderMatches: z.boolean(),
    reason: z.enum(['MATCHED', 'EXCLUDED', 'NO_MATCH', 'MISSING_TITLE', 'UPLOADER_MISMATCH']),
    titleIndex: z.number().int().nonnegative().nullable(),
    condition: archiveTitleConditionSchema.nullable(),
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

function testCondition(title: string, condition: ArchiveTitleCondition): boolean {
  const needle = normalized(condition.text)
  switch (condition.operator) {
    case 'EQUALS':
      return title === needle
    case 'STARTS_WITH':
      return title.startsWith(needle)
    case 'ENDS_WITH':
      return title.endsWith(needle)
    case 'CONTAINS':
      return title.includes(needle)
    case 'WHOLE_WORD': {
      let index = title.indexOf(needle)
      while (index !== -1) {
        const before = Array.from(title.slice(0, index)).at(-1)
        const after = Array.from(title.slice(index + needle.length))[0]
        if ((!before || !wordCharacter.test(before)) && (!after || !wordCharacter.test(after))) return true
        index = title.indexOf(needle, index + 1)
      }
      return false
    }
  }
}

export function evaluateArchiveTitleRules(
  input: ArchiveTitleRules,
  evidence: ArchiveTitleEvidence,
  uploaderMatches = true
): ArchiveTitleEvaluation {
  const rules = archiveTitleRulesSchema.parse(input)
  const titles = evidence.titles.map((title) => normalized(decodeArchiveTitle(title)))
  const result = (
    reason: ArchiveTitleEvaluation['reason'],
    titleIndex: number | null = null,
    condition: ArchiveTitleCondition | null = null
  ): ArchiveTitleEvaluation => ({
    matched: reason === 'MATCHED',
    uploaderMatches,
    reason,
    titleIndex,
    condition,
    evidence
  })
  if (!uploaderMatches) return result('UPLOADER_MISMATCH')
  if (!titles.some(Boolean)) return result('MISSING_TITLE')
  for (const [index, title] of titles.entries()) {
    const excluded = rules.none.find((condition) => testCondition(title, condition))
    if (excluded) return result('EXCLUDED', index, excluded)
  }
  for (const [index, title] of titles.entries()) {
    const included = rules.any.find((condition) => testCondition(title, condition))
    if (included && rules.all.every((condition) => testCondition(title, condition)))
      return result('MATCHED', index, included)
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
          const canonical = { operator: condition.operator, text: normalized(condition.text) }
          return [JSON.stringify(canonical), canonical] as const
        })
      ).values()
    ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'))
  const parsed = archiveTitleRulesSchema.parse(rules)
  return { version: 1, any: group(parsed.any), all: group(parsed.all), none: group(parsed.none) }
}

/** Preserve existing hashes for an equivalent legacy rule, including uploader identity normalization. */
export function archiveTitleQueryIdentity(query: ArchiveTitleQuery, rules: ArchiveTitleRules): string {
  const canonical = canonicalArchiveTitleRules(rules)
  const condition = canonical.any[0]!
  const simple =
    canonical.any.length === 1 &&
    !canonical.all.length &&
    !canonical.none.length &&
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
export const archiveTitleRulePreviewPayloadSchema = z.object({ revisionId: z.string().min(1).max(128) }).strict()
