import z from 'zod'
import type { ScanAuditHooks } from '@/services/scan-service/types'

export const LOCAL_IMPORT_DIRECTORY = 'local-imports'
export const LOCAL_IMPORT_ROOT_DISPLAY = 'scanPath/local-imports'

/** 将用户提供的存储路径规范为受 scanPath 约束的 POSIX 相对路径。 */
export function canonicalizeLocalImportStoragePath(value: string): string {
  const input = value.trim().replace(/\\/g, '/')
  if (!input || input.startsWith('/') || /^[A-Za-z]:/.test(input)) {
    throw new Error('Storage path must be relative to scanPath')
  }

  const segments: string[] = []
  for (const segment of input.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      // 允许在路径内部消解上级片段，但不允许越过 scanPath 根目录。
      if (segments.length === 0) throw new Error('Storage path escapes scanPath')
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  if (segments.length === 0) throw new Error('Storage path must not be empty')
  return segments.join('/')
}

export const localImportStoragePathSchema = z.string().transform(canonicalizeLocalImportStoragePath)

export const localImportDiscoveryInputSchema = z.object({
  scanPath: z.string().trim().min(1)
})
export type LocalImportDiscoveryInput = z.infer<typeof localImportDiscoveryInputSchema>

export const localImportArtistDirectorySchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.startsWith('.') && !/[\\/]/.test(value) && value !== '..', 'Invalid artist directory')

export const saveLocalImportArtistMappingSchema = z.object({
  artistDirectory: localImportArtistDirectorySchema,
  artistId: z.number().int().positive()
})
export type SaveLocalImportArtistMappingInput = z.infer<typeof saveLocalImportArtistMappingSchema>

export const saveLocalImportArtistMappingsSchema = z.object({
  mappings: z.array(saveLocalImportArtistMappingSchema).min(1)
})
export type SaveLocalImportArtistMappingsInput = z.infer<typeof saveLocalImportArtistMappingsSchema>

export const localImportWorkStoragePathSchema = localImportStoragePathSchema.refine((value) => {
  const segments = value.split('/')
  return (
    segments[0] === LOCAL_IMPORT_DIRECTORY &&
    segments.length >= 3 &&
    localImportArtistDirectorySchema.safeParse(segments[1]).success
  )
}, 'Invalid local import work path')

export const startLocalImportSchema = z.object({
  storagePaths: z
    .array(localImportWorkStoragePathSchema)
    .min(1)
    .max(10_000)
    .refine((values) => new Set(values).size === values.length, 'Duplicate local import work path')
})
export type StartLocalImportInput = z.infer<typeof startLocalImportSchema>

export type LocalImportWorkStatus = 'new' | 'existing' | 'invalid'

export interface LocalImportWorkItem {
  workDirectory: string
  relativeDirectory: string
  title: string
  storagePath: string
  status: LocalImportWorkStatus
  mediaCount: number
  error?: string
}

export interface LocalImportArtistItem {
  artistDirectory: string
  mapping: { artistId: number; artistName: string } | null
  works: LocalImportWorkItem[]
}

export interface LocalImportDiscoveryResult {
  importRoot: string
  importRootDisplay: typeof LOCAL_IMPORT_ROOT_DISPLAY
  artists: LocalImportArtistItem[]
  counts: {
    artists: number
    works: number
    new: number
    existing: number
    invalid: number
    media: number
  }
}

export interface LocalImportProgress {
  current: number
  total: number
  artistDirectory: string
  workDirectory: string
  relativeDirectory: string
  status: 'imported' | 'skipped' | 'failed'
  message?: string
}

export interface RunLocalImportInput {
  scanPath: string
  defaultTagIds?: number[]
  // 取消检查和进度回调由任务队列注入，使同一导入逻辑也能被同步调用方复用。
  checkCancelled?: () => Promise<boolean>
  onProgress?: (progress: LocalImportProgress) => Promise<void> | void
  audit?: ScanAuditHooks
}

export interface LocalImportRunResult {
  total: number
  candidates: number
  imported: number
  skipped: number
  failed: number
  newImages: number
  errors: string[]
  processingTime: number
}
