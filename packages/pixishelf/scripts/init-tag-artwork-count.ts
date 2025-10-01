#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client'

/**
 * 标签作品数量初始化脚本
 * 计算并更新所有现有标签的artworkCount字段
 */

const prisma = new PrismaClient()

async function initializeTagArtworkCount() {
  console.log('🚀 开始初始化标签作品数量...')

  try {
    // 获取所有标签
    const tags = await prisma.tag.findMany({
      select: {
        id: true,
        name: true
      }
    })

    console.log(`📊 找到 ${tags.length} 个标签需要更新`)

    let updatedCount = 0
    const batchSize = 100 // 批量处理，避免内存问题

    // 分批处理标签
    for (let i = 0; i < tags.length; i += batchSize) {
      const batch = tags.slice(i, i + batchSize)

      // 使用事务批量更新
      await prisma.$transaction(async (tx) => {
        for (const tag of batch) {
          // 计算该标签的作品数量
          const artworkCount = await tx.artworkTag.count({
            where: {
              tagId: tag.id
            }
          })

          // 更新标签的artworkCount字段
          await tx.tag.update({
            where: {
              id: tag.id
            },
            data: {
              artworkCount
            }
          })

          updatedCount++

          if (updatedCount % 50 === 0) {
            console.log(`✅ 已更新 ${updatedCount}/${tags.length} 个标签`)
          }
        }
      })
    }

    console.log(`🎉 成功更新了 ${updatedCount} 个标签的作品数量`)

    // 显示统计信息
    const stats = await prisma.tag.aggregate({
      _count: {
        id: true
      },
      _sum: {
        artworkCount: true
      },
      _max: {
        artworkCount: true
      },
      _min: {
        artworkCount: true
      }
    })

    console.log('📈 统计信息:')
    console.log(`   总标签数: ${stats._count.id}`)
    console.log(`   总作品关联数: ${stats._sum.artworkCount || 0}`)
    console.log(`   最大作品数: ${stats._max.artworkCount || 0}`)
    console.log(`   最小作品数: ${stats._min.artworkCount || 0}`)

    // 显示热门标签
    const popularTags = await prisma.tag.findMany({
      where: {
        artworkCount: {
          gt: 0
        }
      },
      orderBy: {
        artworkCount: 'desc'
      },
      take: 10,
      select: {
        name: true,
        artworkCount: true
      }
    })

    console.log('🔥 热门标签 (前10):')
    popularTags.forEach((tag, index) => {
      console.log(`   ${index + 1}. ${tag.name}: ${tag.artworkCount} 个作品`)
    })
  } catch (error) {
    console.error('❌ 初始化失败:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  initializeTagArtworkCount()
    .then(() => {
      console.log('✨ 初始化完成')
      process.exit(0)
    })
    .catch((error) => {
      console.error('💥 初始化失败:', error)
      process.exit(1)
    })
}

export { initializeTagArtworkCount }
