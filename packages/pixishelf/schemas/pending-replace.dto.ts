import { z } from 'zod'

export const PENDING_REPLACE_DIRECTORY = 'pending-replaces'
export const PENDING_REPLACE_HEARTBEAT_INTERVAL_MS = 5_000
export const PENDING_REPLACE_STALE_JOB_MS = 120_000
export const PENDING_REPLACE_WORK_DIRECTORY = '.replace-work'
export const PENDING_REPLACE_BACKUP_DIRECTORY = 'replace-backups'
export const PENDING_REPLACE_COMPLETED_DIRECTORY = 'completed-replaces'
export const PENDING_REPLACE_EXTERNAL_ID_MARKER = '__ext-'
export const PENDING_REPLACE_MANIFEST_FILE = 'replace-manifest.json'

export const pendingReplaceExternalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value !== '.' &&
      value !== '..' &&
      !/[<>:"/\\|?*]/.test(value) &&
      !Array.from(value).some((character) => character.charCodeAt(0) < 32),
    'externalId 包含不安全的文件名字符'
  )

export type PendingReplaceManifestFileKind = 'media' | 'chapter' | 'ignored'

const pendingReplaceFileNameSchema = z.string().trim().min(1).max(255).refine(
  (value) => value !== '.' && value !== '..' && !/[\\/]/.test(value),
  '必须是安全的直属文件名'
)

export const pendingReplaceManifestFileSchema = z.object({
  name: pendingReplaceFileNameSchema,
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().finite().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  kind: z.enum(['media', 'chapter', 'ignored']),
  targetName: pendingReplaceFileNameSchema.optional(),
  relatedMediaName: pendingReplaceFileNameSchema.optional(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional()
})

export const pendingReplaceTargetFileSnapshotSchema = z.object({
  name: pendingReplaceFileNameSchema,
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().finite().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
})

export const pendingReplaceMediaSnapshotSchema = z.object({
  sourceName: pendingReplaceFileNameSchema,
  targetName: pendingReplaceFileNameSchema,
  path: z.string().trim().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  databaseSize: z.number().int().nonnegative().nullable().optional(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  order: z.number().int().nonnegative(),
  mtimeMs: z.number().finite().nonnegative().optional(),
  mediaType: z.string().nullable().optional(),
  chaptersPath: z.string().trim().min(1).nullable().optional(),
  chaptersMtimeMs: z.number().finite().nonnegative().optional(),
  chaptersSha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
})

export const pendingReplaceManifestSchema = z.array(pendingReplaceManifestFileSchema).max(20_000)
export const pendingReplaceMediaSnapshotListSchema = z.array(pendingReplaceMediaSnapshotSchema).max(20_000)
export const pendingReplaceTargetFileSnapshotListSchema = z
  .array(pendingReplaceTargetFileSnapshotSchema)
  .max(20_000)
export const pendingReplaceWarningsSchema = z.array(z.string()).max(20_000)

export type PendingReplaceManifestFile = z.infer<typeof pendingReplaceManifestFileSchema>
export type PendingReplaceMediaSnapshot = z.infer<typeof pendingReplaceMediaSnapshotSchema>
export type PendingReplaceTargetFileSnapshot = z.infer<typeof pendingReplaceTargetFileSnapshotSchema>

export function parsePendingReplaceManifest(value: unknown): PendingReplaceManifestFile[] {
  return pendingReplaceManifestSchema.parse(value)
}

export function parsePendingReplaceMediaSnapshot(value: unknown): PendingReplaceMediaSnapshot[] {
  return pendingReplaceMediaSnapshotListSchema.parse(value)
}

export function parsePendingReplaceTargetFileSnapshot(value: unknown): PendingReplaceTargetFileSnapshot[] {
  return pendingReplaceTargetFileSnapshotListSchema.parse(value)
}

export interface PendingReplaceBatchResult {
  batchId: string
  total: number
  succeeded: number
  failed: number
  excluded: number
  cancelled: boolean
  backupBytes: number
  processingTime: number
}

export const pendingReplaceBatchIdSchema = z.object({
  batchId: z.string().trim().min(1)
})

export const startPendingReplaceSchema = pendingReplaceBatchIdSchema.extend({
  itemIds: z.array(z.string().trim().min(1)).max(5000).optional()
})

export const pendingReplaceItemIdSchema = z.object({
  itemId: z.string().trim().min(1)
})

export const bindPendingReplaceItemSchema = pendingReplaceItemIdSchema.extend({
  artworkId: z.number().int().positive()
})

export const reorderPendingReplaceItemSchema = pendingReplaceItemIdSchema.extend({
  orderedSourceNames: z.array(z.string().trim().min(1)).min(1).max(10000)
})

export function parsePendingReplaceDirectoryName(directoryName: string): {
  originalName: string
  externalId: string
} | null {
  const markerIndex = directoryName.lastIndexOf(PENDING_REPLACE_EXTERNAL_ID_MARKER)
  if (markerIndex < 0) return null

  const originalName = directoryName.slice(0, markerIndex).trim()
  const externalId = directoryName.slice(markerIndex + PENDING_REPLACE_EXTERNAL_ID_MARKER.length).trim()
  if (!originalName || !pendingReplaceExternalIdSchema.safeParse(externalId).success) return null

  return { originalName, externalId }
}
