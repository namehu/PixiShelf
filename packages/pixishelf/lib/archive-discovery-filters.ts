import { z } from 'zod'

export const DISCOVERY_UNKNOWN = '__unknown__'
export const DISCOVERY_CATEGORIES = [
  'Doujinshi',
  'Manga',
  'Artist CG',
  'Game CG',
  'Western',
  'Non-H',
  'Image Set',
  'Cosplay',
  'Asian Porn',
  'Misc'
] as const
export const DISCOVERY_LANGUAGES: Record<string, string> = {
  japanese: '日语',
  chinese: '中文',
  english: '英语',
  korean: '韩语',
  french: '法语',
  german: '德语',
  spanish: '西班牙语',
  italian: '意大利语',
  russian: '俄语',
  portuguese: '葡萄牙语',
  thai: '泰语',
  vietnamese: '越南语',
  indonesian: '印度尼西亚语',
  polish: '波兰语',
  dutch: '荷兰语',
  arabic: '阿拉伯语',
  turkish: '土耳其语',
  ukrainian: '乌克兰语',
  czech: '捷克语',
  hungarian: '匈牙利语',
  finnish: '芬兰语',
  swedish: '瑞典语',
  danish: '丹麦语',
  norwegian: '挪威语',
  romanian: '罗马尼亚语',
  greek: '希腊语',
  hebrew: '希伯来语',
  hindi: '印地语',
  tagalog: '他加禄语',
  latin: '拉丁语',
  esperanto: '世界语',
  speechless: '无对白'
}

export const archiveDiscoveryFiltersSchema = z
  .object({
    search: z.string().trim().max(200).default(''),
    categories: z.array(z.string().max(80)).max(20).default([]),
    languages: z
      .array(z.string().refine((value) => value === DISCOVERY_UNKNOWN || Object.hasOwn(DISCOVERY_LANGUAGES, value)))
      .max(40)
      .default([]),
    postedFrom: z.coerce.date().optional(),
    postedBefore: z.coerce.date().optional(),
    unknownDate: z.boolean().default(false)
  })
  .strict()
  .refine((value) => !value.postedFrom || !value.postedBefore || value.postedFrom < value.postedBefore, {
    message: '开始日期不能晚于结束日期',
    path: ['postedBefore']
  })
  .refine((value) => !value.unknownDate || (!value.postedFrom && !value.postedBefore), {
    message: '发布时间未知不能与日期范围同时使用',
    path: ['unknownDate']
  })

export type ArchiveDiscoveryFilters = z.input<typeof archiveDiscoveryFiltersSchema>
export function hasDiscoveryFilters(filters?: ArchiveDiscoveryFilters) {
  return Boolean(
    filters &&
      (filters.search?.trim() ||
        filters.categories?.length ||
        filters.languages?.length ||
        filters.postedFrom ||
        filters.postedBefore ||
        filters.unknownDate)
  )
}

export const archiveDiscoveryCatalogCountsSchema = z
  .object({
    sourceId: z.string().trim().min(1).max(128).optional(),
    unboundOnly: z.boolean().default(false),
    filters: archiveDiscoveryFiltersSchema.optional()
  })
  .strict()
  .refine((input) => (!input.unboundOnly && !hasDiscoveryFilters(input.filters)) || Boolean(input.sourceId), {
    message: '内容筛选必须指定来源',
    path: ['sourceId']
  })
