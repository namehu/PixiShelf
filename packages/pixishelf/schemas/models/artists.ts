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
  backgroundImg: true,
  isStarred: true,
  externalRefs: {
    select: {
      id: true,
      providerKey: true,
      externalId: true,
      sourceName: true,
      status: true,
      lastAttemptAt: true,
      lastSuccessAt: true,
      lastErrorCode: true,
      lastError: true,
      lastSystemJobId: true
    }
  },
  localImportMappings: { select: { id: true } }
} satisfies Prisma.ArtistSelect
