import { Prisma } from '@prisma/client'

// 定义通用的 Tag 查询字段
export const TAG_SELECT = {
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
} satisfies Prisma.TagSelect
