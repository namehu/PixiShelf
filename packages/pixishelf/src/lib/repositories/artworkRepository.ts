import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

/**
 * 作品数据访问层 - Repository 模式
 * 职责：封装所有作品相关的数据库查询操作
 */
export const artworkRepository = {
  /**
   * 使用原生 SQL 随机获取作品 ID
   * @param limit 获取数量限制
   * @returns 随机作品 ID 数组
   */
  async findRandomIds(limit: number): Promise<number[]> {
    type ArtworkId = {
      id: number
    }

    const randomIdsResult = await prisma.$queryRaw<ArtworkId[]>(
      Prisma.sql`SELECT id FROM "Artwork" ORDER BY RANDOM() LIMIT ${limit}`
    )

    return randomIdsResult.map((artwork) => artwork.id)
  },

  /**
   * 根据 ID 数组查询完整的作品数据
   * @param ids 作品 ID 数组
   * @returns 作品数据数组
   */
  async findManyByIds(ids: number[]) {
    return prisma.artwork.findMany({
      where: {
        id: {
          in: ids
        }
      },
      include: {
        images: { take: 1, orderBy: { sortOrder: 'asc' } },
        artist: true,
        artworkTags: { include: { tag: true } },
        _count: { select: { images: true } }
      }
    })
  },

  /**
   * 查询最新作品
   * @param options 查询选项
   * @returns 作品数据数组
   */
  async findRecent(options: { skip: number; take: number }) {
    return prisma.artwork.findMany({
      include: {
        images: { take: 1, orderBy: { sortOrder: 'asc' } },
        artist: true,
        artworkTags: { include: { tag: true } },
        _count: { select: { images: true } }
      },
      orderBy: { directoryCreatedAt: 'desc' },
      skip: options.skip,
      take: options.take
    })
  },

  /**
   * 获取作品总数
   * @returns 作品总数
   */
  async count(): Promise<number> {
    return prisma.artwork.count()
  },

  /**
   * 通用查询方法
   * @param options Prisma 查询选项
   * @returns 作品数据数组
   */
  async findMany(options: Prisma.ArtworkFindManyArgs) {
    return prisma.artwork.findMany(options)
  },

  /**
   * 根据 ID 查询单个作品
   * @param id 作品 ID
   * @returns 作品数据或 null
   */
  async findById(id: number) {
    return prisma.artwork.findUnique({
      where: { id },
      include: {
        artist: true,
        artworkTags: {
          include: { tag: true }
        },
        images: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    })
  },

  /**
   * 创建新作品
   * @param data 作品数据
   * @returns 创建的作品
   */
  async create(data: Prisma.ArtworkCreateInput) {
    return prisma.artwork.create({ data })
  },

  /**
   * 更新作品
   * @param id 作品 ID
   * @param data 更新数据
   * @returns 更新后的作品
   */
  async update(id: number, data: Prisma.ArtworkUpdateInput) {
    return prisma.artwork.update({
      where: { id },
      data
    })
  },

  /**
   * 删除作品
   * @param id 作品 ID
   * @returns 删除的作品
   */
  async delete(id: number) {
    return prisma.artwork.delete({ where: { id } })
  }
}

export type ArtworkRepository = typeof artworkRepository
