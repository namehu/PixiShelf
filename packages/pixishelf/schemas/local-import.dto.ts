import z from 'zod'

export const LOCAL_IMPORT_DIRECTORY = 'local-imports'
export const LOCAL_IMPORT_ROOT_DISPLAY = 'scanPath/local-imports'

export function canonicalizeLocalImportStoragePath(value: string): string {
  const input = value.trim().replace(/\\/g, '/')
  if (!input || input.startsWith('/') || /^[A-Za-z]:/.test(input)) {
    throw new Error('Storage path must be relative to scanPath')
  }

  const segments: string[] = []
  for (const segment of input.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
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

export type LocalImportWorkStatus = 'new' | 'existing' | 'invalid'

export interface LocalImportWorkItem {
  workDirectory: string
  title: string
  storagePath: string
  status: LocalImportWorkStatus
  mediaFiles: string[]
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
  status: 'imported' | 'skipped' | 'failed'
  message?: string
}

export interface RunLocalImportInput {
  scanPath: string
  checkCancelled?: () => Promise<boolean>
  onProgress?: (progress: LocalImportProgress) => Promise<void> | void
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
