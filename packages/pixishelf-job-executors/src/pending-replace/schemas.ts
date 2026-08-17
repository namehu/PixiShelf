import { z } from 'zod'
import type {
  PendingReplaceManifestFile,
  PendingReplaceMediaSnapshot,
  PendingReplaceTargetFileSnapshot
} from './types.js'
import { PendingReplacePermanentError } from './types.js'

export const MAX_PENDING_REPLACE_ENTRIES = 1_234
export const MAX_PENDING_REPLACE_WARNINGS = 123
export const MAX_PENDING_REPLACE_JSON_BYTES = 2 * 1024 * 1024

const safeFileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => value !== '.' && value !== '..' && !/[\\/]/.test(value), 'Expected a safe direct file name')
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const storedPath = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine((value) => !value.split(/[\\/]+/).includes('..'), 'Parent traversal is not allowed')

export const pendingReplaceManifestFileSchema = z
  .object({
    name: safeFileName,
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    mtimeMs: z.number().finite().nonnegative(),
    sha256: digest,
    kind: z.enum(['media', 'chapter', 'ignored']),
    targetName: safeFileName.optional(),
    relatedMediaName: safeFileName.optional()
  })
  .strict()

export const pendingReplaceMediaSnapshotSchema = z
  .object({
    sourceName: safeFileName,
    targetName: safeFileName,
    path: storedPath,
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sha256: digest,
    databaseSize: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    order: z.number().int().nonnegative(),
    mtimeMs: z.number().finite().nonnegative(),
    mediaType: z.enum(['IMAGE', 'VIDEO', 'ANIMATION', 'UNKNOWN']).nullable().optional(),
    chaptersPath: storedPath.nullable().optional(),
    chaptersMtimeMs: z.number().finite().nonnegative().optional(),
    chaptersSha256: digest.optional()
  })
  .strict()

export const pendingReplaceTargetFileSnapshotSchema = z
  .object({
    name: safeFileName,
    size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    mtimeMs: z.number().finite().nonnegative(),
    sha256: digest
  })
  .strict()

export const pendingReplaceManifestSchema = z
  .array(pendingReplaceManifestFileSchema)
  .max(MAX_PENDING_REPLACE_ENTRIES)
  .superRefine((entries, context) => {
    addDuplicateIssues(entries, (entry) => entry.name, context, 'manifest source name')
    addDuplicateIssues(
      entries.filter((entry) => entry.kind !== 'ignored' && entry.targetName),
      (entry) => entry.targetName!,
      context,
      'manifest target name'
    )
  })
export const pendingReplaceMediaListSchema = z
  .array(pendingReplaceMediaSnapshotSchema)
  .max(MAX_PENDING_REPLACE_ENTRIES)
  .superRefine((entries, context) => {
    addDuplicateIssues(entries, (entry) => entry.sourceName, context, 'media source name')
    addDuplicateIssues(entries, (entry) => entry.targetName, context, 'media target name')
    addDuplicateIssues(entries, (entry) => String(entry.order), context, 'media order')
  })
export const pendingReplaceTargetListSchema = z
  .array(pendingReplaceTargetFileSnapshotSchema)
  .max(MAX_PENDING_REPLACE_ENTRIES)
  .superRefine((entries, context) => {
    addDuplicateIssues(entries, (entry) => entry.name, context, 'target file name')
  })
export const pendingReplaceWarningListSchema = z.array(z.string().max(1_000)).max(MAX_PENDING_REPLACE_WARNINGS)

export function parsePendingReplaceManifest(value: unknown, maximumBytes = MAX_PENDING_REPLACE_JSON_BYTES) {
  return parseBoundedJson(pendingReplaceManifestSchema, value, maximumBytes, 'manifest') as PendingReplaceManifestFile[]
}

export function parsePendingReplaceMedia(value: unknown, maximumBytes = MAX_PENDING_REPLACE_JSON_BYTES) {
  return parseBoundedJson(
    pendingReplaceMediaListSchema,
    value,
    maximumBytes,
    'media snapshot'
  ) as PendingReplaceMediaSnapshot[]
}

export function parsePendingReplaceTargets(value: unknown, maximumBytes = MAX_PENDING_REPLACE_JSON_BYTES) {
  return parseBoundedJson(
    pendingReplaceTargetListSchema,
    value,
    maximumBytes,
    'target snapshot'
  ) as PendingReplaceTargetFileSnapshot[]
}

export function parsePendingReplaceWarnings(value: unknown, maximumBytes = MAX_PENDING_REPLACE_JSON_BYTES) {
  return parseBoundedJson(pendingReplaceWarningListSchema, value, maximumBytes, 'warnings') as string[]
}

function parseBoundedJson(schema: z.ZodType, value: unknown, maximumBytes: number, label: string): unknown {
  if (!Number.isInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_PENDING_REPLACE_JSON_BYTES) {
    throw new Error('maximumSnapshotBytes is outside the supported range')
  }
  assertJsonDepth(value, 0)
  let bytes: number
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    throw new PendingReplacePermanentError('INVALID_SNAPSHOT', `${label} is not valid JSON`)
  }
  if (bytes > maximumBytes) {
    throw new PendingReplacePermanentError('LIMIT_EXCEEDED', `${label} exceeds the persisted JSON byte limit`)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new PendingReplacePermanentError('INVALID_SNAPSHOT', `${label} has an invalid shape`)
  return parsed.data
}

function assertJsonDepth(value: unknown, depth: number): void {
  if (depth > 8) throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Persisted JSON exceeds the depth limit')
  if (Array.isArray(value)) {
    for (const entry of value) assertJsonDepth(entry, depth + 1)
  } else if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) assertJsonDepth(entry, depth + 1)
  }
}

function addDuplicateIssues<T>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
  context: z.RefinementCtx,
  label: string
) {
  const seen = new Set<string>()
  entries.forEach((entry, index) => {
    const key = keyOf(entry).normalize('NFC').toLocaleLowerCase('en-US')
    if (seen.has(key)) {
      context.addIssue({ code: 'custom', path: [index], message: `Duplicate ${label}` })
    } else {
      seen.add(key)
    }
  })
}
