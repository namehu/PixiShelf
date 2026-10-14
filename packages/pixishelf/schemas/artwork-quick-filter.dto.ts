import { z } from 'zod'

export const QUICK_FILTER_PREFIX = 'artwork_quick_filter:'
export const QUICK_FILTER_NAV_KEY = `${QUICK_FILTER_PREFIX}navigation`
export const readingFilterLabels = { all: '全部', UNREAD: '未读', IN_PROGRESS: '阅读中', COMPLETED: '已读完' } as const
export const quickFilterNameSchema = z.string().trim().min(1, '请输入名称').max(40, '名称最多 40 字')
const option = z.object({
  value: z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine((v) => Number.isSafeInteger(Number(v))),
  label: z.string().max(500)
})
const date = z.string().date().or(z.literal('')).default('')
export const artworkQuerySnapshotSchema = z
  .object({
    search: z.string().trim().max(1000).default(''),
    mediaType: z.enum(['all', 'image', 'animation', 'video']).default('all'),
    sortBy: z
      .enum([
        'source_date_desc',
        'source_date_asc',
        'created_at_desc',
        'created_at_asc',
        'title_asc',
        'title_desc',
        'artist_asc',
        'artist_desc',
        'images_desc',
        'images_asc',
        'random'
      ])
      .default('source_date_desc'),
    artist: z.array(option).max(1).default([]),
    tags: z.array(option).max(100).default([]),
    sources: z
      .array(z.enum(['PIXIV_IMPORTED', 'LOCAL_IMPORT', 'LOCAL_CREATED', 'URL_ARCHIVE']))
      .max(4)
      .default([]),
    hasAudio: z.enum(['all', 'yes', 'no']).default('all'),
    readingStatus: z.enum(['all', 'UNREAD', 'IN_PROGRESS', 'COMPLETED']).default('all'),
    startDate: date,
    endDate: date,
    createdStartDate: date,
    createdEndDate: date
  })
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, '原始时间范围无效')
  .refine((v) => !v.createdStartDate || !v.createdEndDate || v.createdStartDate <= v.createdEndDate, '入库时间范围无效')
export type ArtworkQuerySnapshot = z.infer<typeof artworkQuerySnapshotSchema>
export const quickFilterSchema = z.object({
  id: z.string().uuid(),
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  name: quickFilterNameSchema,
  query: artworkQuerySnapshotSchema,
  createdAt: z.string().datetime()
})
export type ArtworkQuickFilter = z.infer<typeof quickFilterSchema> & { invalidReferences?: string[] }
export const quickFilterNavigationSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    ids: z.array(z.string().uuid()).max(10)
  })
  .refine((v) => new Set(v.ids).size === v.ids.length, '导航项不能重复')
export const quickFilterAccountSchema = z.object({ expectedUserId: z.string().min(1) })
export const quickFilterCreateSchema = quickFilterAccountSchema.extend({
  name: quickFilterNameSchema,
  query: artworkQuerySnapshotSchema,
  pin: z.boolean()
})
export const quickFilterUpdateSchema = quickFilterAccountSchema.extend({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  name: quickFilterNameSchema,
  query: artworkQuerySnapshotSchema
})
export const quickFilterDeleteSchema = quickFilterAccountSchema.extend({
  id: z.string().uuid(),
  revision: z.number().int().positive()
})
export const quickFilterSetNavigationSchema = quickFilterAccountSchema.extend({
  navigation: quickFilterNavigationSchema
})
