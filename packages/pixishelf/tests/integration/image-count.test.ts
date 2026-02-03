import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'

// 注意：运行此测试前需要先应用 migration
// npx prisma migrate dev

const prisma = new PrismaClient()

describe('Artwork Image Count Trigger', () => {
  let artistId: number
  let artworkId: number

  beforeAll(async () => {
    // 创建测试用的 Artist
    const artist = await prisma.artist.create({
      data: {
        name: 'Test Artist for Image Count',
      }
    })
    artistId = artist.id
  })

  afterAll(async () => {
    // 清理数据
    if (artistId) {
      // 级联删除会删除 artwork 和 images
      try {
        await prisma.artist.delete({ where: { id: artistId } })
      } catch (e) {
        console.error('Cleanup failed:', e)
      }
    }
    await prisma.$disconnect()
  })

  it('should auto-increment imageCount when adding images', async () => {
    // 1. 创建 Artwork
    const artwork = await prisma.artwork.create({
      data: {
        title: 'Test Artwork',
        artistId: artistId,
        imageCount: 0 // 显式设为 0
      }
    })
    artworkId = artwork.id
    expect(artwork.imageCount).toBe(0)

    // 2. 添加 3 张图片
    await prisma.image.createMany({
      data: [
        { path: 'test/1.jpg', artworkId: artwork.id, sortOrder: 0 },
        { path: 'test/2.jpg', artworkId: artwork.id, sortOrder: 1 },
        { path: 'test/3.jpg', artworkId: artwork.id, sortOrder: 2 },
      ]
    })

    // 3. 验证 imageCount
    const updatedArtwork = await prisma.artwork.findUnique({
      where: { id: artwork.id }
    })
    expect(updatedArtwork?.imageCount).toBe(3)
  })

  it('should auto-decrement imageCount when deleting images', async () => {
    // 删除 1 张图片
    const image = await prisma.image.findFirst({
      where: { artworkId: artworkId }
    })
    if (image) {
      await prisma.image.delete({ where: { id: image.id } })
    }

    const updatedArtwork = await prisma.artwork.findUnique({
      where: { id: artworkId }
    })
    expect(updatedArtwork?.imageCount).toBe(2)
  })

  it('should handle concurrent image insertions', async () => {
    // 并发插入 10 张图片
    const promises = []
    for (let i = 0; i < 10; i++) {
      promises.push(
        prisma.image.create({
          data: {
            path: `test/concurrent_${i}.jpg`,
            artworkId: artworkId,
            sortOrder: 10 + i
          }
        })
      )
    }
    await Promise.all(promises)

    const updatedArtwork = await prisma.artwork.findUnique({
      where: { id: artworkId }
    })
    // 之前 2 + 10 = 12
    expect(updatedArtwork?.imageCount).toBe(12)
  })
  
  it('should update imageCount when moving image to another artwork', async () => {
     // 创建另一个 Artwork
     const artwork2 = await prisma.artwork.create({
      data: {
        title: 'Test Artwork 2',
        artistId: artistId,
        imageCount: 0
      }
    })
    
    // 从 artworkId 移动一张图片到 artwork2.id
    const imageToMove = await prisma.image.findFirst({
        where: { artworkId: artworkId }
    })
    
    if (imageToMove) {
        await prisma.image.update({
            where: { id: imageToMove.id },
            data: { artworkId: artwork2.id }
        })
    }
    
    // 验证源作品计数 -1 (12 -> 11)
    const sourceArtwork = await prisma.artwork.findUnique({ where: { id: artworkId } })
    expect(sourceArtwork?.imageCount).toBe(11)
    
    // 验证目标作品计数 +1 (0 -> 1)
    const targetArtwork = await prisma.artwork.findUnique({ where: { id: artwork2.id } })
    expect(targetArtwork?.imageCount).toBe(1)
  })
})
