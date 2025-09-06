import { SortOption } from '@pixishelf/shared'

/**
 * Prisma OrderBy 类型定义
 */
type PrismaOrderBy = {
  [key: string]: 'asc' | 'desc' | PrismaOrderBy
}

/**
 * 排序选项到 Prisma orderBy 的映射
 */
const sortMappings: Record<SortOption, PrismaOrderBy> = {
  'title_asc': { title: 'asc' },
  'title_desc': { title: 'desc' },
  'artist_asc': { artist: { name: 'asc' } },
  'artist_desc': { artist: { name: 'desc' } },
  'images_desc': { imageCount: 'desc' },
  'images_asc': { imageCount: 'asc' },
  'source_date_desc': { sourceDate: 'desc' },
  'source_date_asc': { sourceDate: 'asc' }
}

/**
 * 排序选项定义（用于前端显示）
 */
export interface SortOptionDefinition {
  value: SortOption
  label: string
  description: string
  group: 'time' | 'name' | 'count'
}

/**
 * 所有可用的排序选项配置
 */
export const sortOptionDefinitions: SortOptionDefinition[] = [
  {
    value: 'source_date_desc',
    label: '创建时间 新-旧',
    description: '按作品创建时间降序排列',
    group: 'time'
  },
  {
    value: 'source_date_asc',
    label: '创建时间 旧-新',
    description: '按作品创建时间升序排列',
    group: 'time'
  },
  {
    value: 'title_asc',
    label: '名称 A-Z',
    description: '按作品标题升序排列',
    group: 'name'
  },
  {
    value: 'title_desc',
    label: '名称 Z-A',
    description: '按作品标题降序排列',
    group: 'name'
  },
  {
    value: 'artist_asc',
    label: '艺术家 A-Z',
    description: '按艺术家名称升序排列',
    group: 'name'
  },
  {
    value: 'artist_desc',
    label: '艺术家 Z-A',
    description: '按艺术家名称降序排列',
    group: 'name'
  },
  {
    value: 'images_desc',
    label: '图片数量 多-少',
    description: '按图片数量降序排列',
    group: 'count'
  },
  {
    value: 'images_asc',
    label: '图片数量 少-多',
    description: '按图片数量升序排列',
    group: 'count'
  }
]

/**
 * 验证排序选项是否有效
 * @param sortBy 排序选项字符串
 * @returns 是否为有效的排序选项
 */
export function isValidSortOption(sortBy: string): sortBy is SortOption {
  return Object.keys(sortMappings).includes(sortBy)
}

/**
 * 将排序选项映射为 Prisma orderBy 对象
 * @param sortBy 排序选项
 * @returns Prisma orderBy 对象
 */
export function mapSortOption(sortBy: SortOption): PrismaOrderBy {
  return sortMappings[sortBy]
}

/**
 * 安全地获取排序选项，无效时返回默认值
 * @param sortBy 排序选项字符串
 * @param defaultSort 默认排序选项
 * @returns 有效的排序选项
 */
export function getSafeSortOption(
  sortBy: string | undefined,
  defaultSort: SortOption = 'source_date_desc'
): SortOption {
  if (!sortBy || !isValidSortOption(sortBy)) {
    return defaultSort
  }
  return sortBy
}

/**
 * 获取排序选项的显示信息
 * @param sortBy 排序选项
 * @returns 排序选项定义，如果不存在则返回undefined
 */
export function getSortOptionDefinition(sortBy: SortOption): SortOptionDefinition | undefined {
  return sortOptionDefinitions.find(def => def.value === sortBy)
}

/**
 * 按组获取排序选项
 * @param group 排序组
 * @returns 该组的所有排序选项
 */
export function getSortOptionsByGroup(group: 'time' | 'name' | 'count'): SortOptionDefinition[] {
  return sortOptionDefinitions.filter(def => def.group === group)
}

/**
 * 获取所有排序选项，按组分类
 * @returns 按组分类的排序选项
 */
export function getGroupedSortOptions(): Record<string, SortOptionDefinition[]> {
  return {
    time: getSortOptionsByGroup('time'),
    name: getSortOptionsByGroup('name'),
    count: getSortOptionsByGroup('count')
  }
}