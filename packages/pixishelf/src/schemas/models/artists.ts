import { Prisma } from '@prisma/client'

// 定义通用的 Artist 查询字段
export const ARTIST_SELECT = {
  id: true,
  name: true,
  username: true,
  userId: true,
  bio: true,
  createdAt: true,
  updatedAt: true,
  avatar: true,
  backgroundImg: true
} satisfies Prisma.ArtistSelect
