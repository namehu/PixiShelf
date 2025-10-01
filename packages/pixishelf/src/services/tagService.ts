import { prisma } from '@/lib/prisma'
import { Tag } from '@/types'
import { combinationStaticTagImage } from '@/utils/combinationStatic'

/**
 * 标签服务层 - 业务逻辑封装
 * 职责：封装标签相关的业务逻辑，数据验证和转换
 */
export class TagService {
  /**
   * 获取标签列表
   * @param options 查询选项
   * @returns 标签列表响应
   */
  async getTags() {}

  /**
   * 根据 ID 获取单个标签
   * @param id 标签 ID
   * @returns 标签数据或 null
   */
  async getById(id: number): Promise<Tag | null> {
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
}

export const tagService = new TagService()
