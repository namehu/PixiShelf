#!/usr/bin/env tsx

import { disconnectDatabase, prisma } from '@/lib/prisma'
import { rebuildTagArtworkCounts } from '@/services/tag-count-service'

/**
 * 标签作品数量初始化脚本
 * 计算并更新所有现有标签的artworkCount字段
 */

async function initializeTagArtworkCount() {
  console.log('🚀 开始初始化标签作品数量...')

  try {
    const result = await rebuildTagArtworkCounts()
    console.log(`🎉 集合式校准完成，共修正 ${result.updatedTags} 个标签`)

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
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  initializeTagArtworkCount()
    .then(() => {
      console.log('✨ 初始化完成')
    })
    .catch((error) => {
      console.error('💥 初始化失败:', error)
      process.exitCode = 1
    })
    .finally(disconnectDatabase)
}

export { initializeTagArtworkCount }
