import path from 'path'
import fs from 'fs/promises'
import { prisma } from '@/lib/prisma'
import { migrationLogger } from '@/lib/logger'
import { getScanPath } from '@/services/setting.service'

// 状态定义
export type MigrationStatus = 'PENDING' | 'SKIPPED' | 'SUCCESS' | 'FAILED'

export interface MigrationResult {
  artworkId: number
  status: MigrationStatus
  msg: string[]
}

export interface MigrationStats {
  total: number
  processed: number
  success: number
  skipped: number
  failed: number
}

/**
 * 迁移单个作品
 */
export async function migrateArtwork(artworkId: number, scanRoot: string): Promise<MigrationResult> {
  const logs: string[] = []
  const log = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
    logs.push(msg)
    if (level === 'error') migrationLogger.error(msg)
    else if (level === 'warn') migrationLogger.warn(msg)
    else migrationLogger.info(msg)
  }

  // 1. 获取数据
  const artwork = await prisma.artwork.findUnique({
    where: { id: artworkId },
    include: { images: true, artist: true }
  })

  if (!artwork || !artwork.artist?.userId || !artwork.externalId || !artwork.images.length) {
    return { artworkId, status: 'FAILED', msg: ['数据不完整 (Artist或Images缺失)'] }
  }

  const targetRelDir = path.join(artwork.artist.userId, artwork.externalId)
  const targetAbsDir = path.join(scanRoot, targetRelDir)

  // 假设第一张图代表当前位置
  const currentRelPath = artwork.images[0]!.path
  const currentAbsPath = path.join(scanRoot, currentRelPath)
  const sourceAbsDir = path.dirname(currentAbsPath)

  // 2. 幂等性检查：如果已经在目标路径下
  // Windows下路径可能包含反斜杠，统一替换为正斜杠比较
  const normalizedCurrent = currentRelPath.replace(/\\/g, '/').replace(/^\//, '')
  const normalizedTarget = targetRelDir.replace(/\\/g, '/')

  if (normalizedCurrent.startsWith(normalizedTarget)) {
    return { artworkId, status: 'SKIPPED', msg: [`路径已符合规范: ${currentRelPath}`] }
  }

  try {
    // 3. 准备文件列表 (图片 + 元数据)
    // 检查源目录是否存在
    try {
      await fs.access(sourceAbsDir)
    } catch {
      // 源目录不存在，但数据库说在这里。可能已经被手动移走了？
      // 尝试检查目标目录是否已经有文件了 (数据库滞后)
      try {
        await fs.access(targetAbsDir)
        // 目标存在，可能是上次迁移了一半数据库没更？
        // 检查目标目录是否有相关文件
        const targetFiles = await fs.readdir(targetAbsDir)
        if (targetFiles.length > 0) {
          // 目标有文件，且数据库没更，这种情况比较危险。
          // 但既然源文件没了，也没法搬了。
          // 暂时标记失败，需要人工介入或更复杂的恢复逻辑
          return { artworkId, status: 'FAILED', msg: ['源目录不存在，目标目录已有文件'] }
        }
      } catch {}
      return { artworkId, status: 'FAILED', msg: ['源目录不存在'] }
    }

    // 查找源目录下所有属于该 ID 的文件 (防止误伤同目录其他作品)
    const sourceFiles = await fs.readdir(sourceAbsDir)
    const relatedFiles = sourceFiles.filter((f) => f.startsWith(artwork.externalId!)) // 匹配 12345_p0.jpg 和 12345-meta.txt

    if (relatedFiles.length === 0) {
      return { artworkId, status: 'FAILED', msg: ['源目录中未找到相关文件'] }
    }

    // 4. 物理搬运
    await fs.mkdir(targetAbsDir, { recursive: true })

    for (const file of relatedFiles) {
      const src = path.join(sourceAbsDir, file)
      const dest = path.join(targetAbsDir, file)

      // 防止源和目标相同导致报错
      if (src !== dest) {
        try {
          await fs.rename(src, dest)
        } catch (e: any) {
          // 如果目标已存在 (可能是上次失败残留)，尝试覆盖或忽略
          if (e.code === 'EEXIST' || e.code === 'EPERM') {
            // 如果是 EPERM (Windows常见)，可能是文件被占用
            throw e
          } else {
            throw e
          }
        }
      }
    }

    // 5. 数据库更新 (事务)
    await prisma.$transaction(async (tx) => {
      // 更新图片
      for (const img of artwork.images) {
        const fileName = path.basename(img.path)
        const newPath = path.join(targetRelDir, fileName).replace(/\\/g, '/') // 统一存为 POSIX 路径
        await tx.image.update({
          where: { id: img.id },
          data: { path: '/' + newPath }
        })
      }
    })

    // 6. 清理空源目录 (可选，需谨慎)
    // 只有当源目录不是根目录时才删除 (避免删掉 SCAN_ROOT)
    // 并且源目录不在目标目录路径上 (虽然不太可能)
    if (path.relative(scanRoot, sourceAbsDir) !== '') {
      try {
        const deleteCandidates = new Set(['@eaDir', '.DS_Store'])
        const entries = await fs.readdir(sourceAbsDir)
        for (const entry of entries) {
          if (deleteCandidates.has(entry)) {
            const entryPath = path.join(sourceAbsDir, entry)
            await fs.rm(entryPath, { recursive: true, force: true })
          }
        }

        const remaining = await fs.readdir(sourceAbsDir)
        if (remaining.length === 0) {
          await fs.rmdir(sourceAbsDir)
          log(`[Migrate] 已移除空目录: ${sourceAbsDir}`, 'info')
        } else {
          log(
            `[Migrate] 源目录非空，跳过删除: ${sourceAbsDir} (剩余 ${remaining.length} 个文件: ${remaining.slice(0, 3).join(', ')}...)`,
            'info'
          )
        }
      } catch (e: any) {
        log(`[Migrate] 尝试删除源目录失败: ${sourceAbsDir}, Error: ${e.message}`, 'warn')
      }
    } else {
      log(`[Migrate] 源目录为根目录，跳过删除: ${sourceAbsDir} （防止删除根目录） ${scanRoot}`, 'info')
    }

    logs.push(`迁移至 ${targetRelDir}`)
    return { artworkId, status: 'SUCCESS', msg: logs }
  } catch (error: any) {
    log(`[Migrate] ID:${artworkId} Failed: ${error.message}`, 'error')
    return { artworkId, status: 'FAILED', msg: logs } // Return collected logs even on failure
  }
}

/**
 * 运行迁移任务
 */
export async function runMigrationJob(
  onProgress: (stats: MigrationStats, currentMsg: string[]) => void,
  checkCancelled: () => Promise<boolean>,
  targetIds?: number[]
): Promise<MigrationStats> {
  const scanPath = await getScanPath()
  if (!scanPath) {
    throw new Error('SCAN_PATH 未配置')
  }

  const stats: MigrationStats = {
    total: 0,
    processed: 0,
    success: 0,
    skipped: 0,
    failed: 0
  }

  // 1. 获取所有待处理的 Artwork ID
  // 过滤掉 artist 为空的 (虽然 schema 关联了但可能有些旧数据)
  const where: any = {
    artist: { isNot: null },
    externalId: { not: null }
  }

  if (targetIds && targetIds.length > 0) {
    where.id = { in: targetIds }
  }

  const artworks = await prisma.artwork.findMany({
    select: { id: true, externalId: true },
    where,
    orderBy: { id: 'asc' }
  })

  stats.total = artworks.length
  migrationLogger.info(`开始迁移任务，共 ${stats.total} 个作品${targetIds ? ` (指定ID: ${targetIds.join(',')})` : ''}`)

  // 2. 遍历处理
  for (const art of artworks) {
    if (await checkCancelled()) {
      migrationLogger.info('迁移任务被取消')
      throw new Error('Migration cancelled')
    }

    const result = await migrateArtwork(art.id, scanPath)

    stats.processed++
    if (result.status === 'SUCCESS') stats.success++
    else if (result.status === 'SKIPPED') stats.skipped++
    else stats.failed++

    if (result.status === 'FAILED') {
      migrationLogger.warn(`[ID:${art.id}] ${result.msg.join('; ')}`)
    } else if (result.status === 'SUCCESS') {
      migrationLogger.info(`[ID:${art.id}] ${result.msg.join('; ')}`)
    }

    onProgress(
      stats,
      result.msg.map((m) => `[${art.externalId}] ${m}`)
    )

    // 简单延时，避免IO过载
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  return stats
}
