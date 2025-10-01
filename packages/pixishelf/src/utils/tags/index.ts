import { Tag } from '@prisma/client'

/**
 * 获取标签的翻译名称
 *
 * 优先返回中文翻译，其次返回英文翻译，最后返回null
 * @param tag
 * @returns
 */
export function getTranslateName(tag: Partial<Pick<Tag, 'name_en' | 'name_zh'>>) {
  return tag.name_zh || tag.name_en || null
}
