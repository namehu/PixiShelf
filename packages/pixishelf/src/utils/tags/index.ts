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

/**
 * 基于字符串生成固定索引，确保颜色持久化
 */
function getIndexFromString(str: string, max: number) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % max
}

export function getRandomColor(seed: string = 'default') {
  const colors = [
    'from-blue-400 to-indigo-500',
    'from-pink-400 to-rose-500',
    'from-emerald-400 to-teal-500',
    'from-amber-400 to-orange-500',
    'from-violet-400 to-purple-600',
    'from-cyan-400 to-blue-500'
  ]
  return colors[getIndexFromString(seed, colors.length)]
}

export function getRandomBorder(seed: string = 'default') {
  const colors = ['border-blue-200', 'border-pink-200', 'border-emerald-200', 'border-amber-200', 'border-violet-200']
  return colors[getIndexFromString(seed, colors.length)]
}
