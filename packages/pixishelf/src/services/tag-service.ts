import { prisma } from '@/lib/prisma'
import { TAG_SELECT } from '@/schemas/models/tags'
import { TTagResponseDto, TagResponseDto } from '@/schemas/tag.dto'

/**
 * 根据 ID 获取单个标签
 * @param id 标签 ID
 * @returns 标签数据或 null
 */
export async function getById(id: number): Promise<TTagResponseDto | null> {
  const tag = await prisma.tag.findUnique({
    where: { id },
    select: TAG_SELECT
  })

  return !tag ? null : TagResponseDto.parse(tag)
}
