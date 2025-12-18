import { prisma } from '@/lib/prisma'
import { Tag } from '@/types'
import { combinationStaticTagImage } from '@/utils/combinationStatic'

/**
 * 根据 ID 获取单个标签
 * @param id 标签 ID
 * @returns 标签数据或 null
 */
export async function getById(id: number): Promise<Tag | null> {
  // 查询标签信息
  const tag = await prisma.tag.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      name_zh: true,
      name_en: true,
      description: true,
      artworkCount: true,
      createdAt: true,
      updatedAt: true,
      image: true,
      abstract: true,
      translateType: true
    }
  })

  return tag
    ? {
        ...tag,
        image: combinationStaticTagImage(tag.image)
      }
    : null
}
