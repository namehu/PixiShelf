// oxlint-disable max-nested-callbacks
import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'
import { getScanPath } from '@/services/setting.service'
import { updateArtworkImagesTransaction, ImageMeta } from '@/services/artwork-service/image-manager'
import { MEDIA_EXTENSIONS } from '../../../../../../lib/constant'
import { getArtworkById } from '@/services/artwork-service'

// 定义 API 支持的操作类型
type ActionType = 'init' | 'commit' | 'rollback'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const artworkId = Number(id)
  const searchParams = req.nextUrl.searchParams
  const action = (searchParams.get('action') as ActionType) || 'init'

  // 1. 基础校验
  if (!artworkId || isNaN(artworkId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
  }
  const scanRoot = await getScanPath()
  if (!scanRoot) return NextResponse.json({ error: 'No SCAN_ROOT' }, { status: 500 })

  const artwork = await getArtworkById(artworkId)
  if (!artwork) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 2. 确定路径
  let targetRelDir = ''
  if (artwork.images && artwork.images.length > 0 && artwork.images[0]?.path) {
    targetRelDir = path.dirname(artwork.images[0].path)
  } else if (artwork.artist?.userId && artwork.externalId) {
    targetRelDir = `/${artwork.artist.userId}/${artwork.externalId}`
  } else {
    return NextResponse.json({ error: 'Cannot determine path' }, { status: 400 })
  }

  const targetDir = path.join(scanRoot, targetRelDir)
  const backupDir = path.join(targetDir, `.bak_session`) // 固定备份目录名，方便会话内复用

  try {
    // ==========================================
    // Phase 1: 初始化 (备份旧文件)
    // ==========================================
    if (action === 'init') {
      if (!fs.existsSync(targetDir)) {
        await fsPromises.mkdir(targetDir, { recursive: true })
      } else {
        // 如果存在上次未清理的备份，先还原或清理，这里简单处理为：如果有备份则认为已备份
        if (!fs.existsSync(backupDir)) {
          await fsPromises.mkdir(backupDir, { recursive: true })
          const existingFiles = await fsPromises.readdir(targetDir)
          for (const f of existingFiles) {
            // 排除备份文件夹本身
            if (f === '.bak_session') continue

            const ext = path.extname(f).toLowerCase()
            if (MEDIA_EXTENSIONS.includes(ext)) {
              await fsPromises.rename(path.join(targetDir, f), path.join(backupDir, f))
            }
          }
        }
      }
      return NextResponse.json({
        success: true,
        message: 'Initialized & Backed up',
        uploadTargetDir: targetDir,
        targetRelDir
      })
    }

    // ==========================================
    // Phase 2: 提交 (数据库更新 & 清理)
    // ==========================================
    if (action === 'commit') {
      const body = await req.json()
      const allFilesMeta: ImageMeta[] = body.filesMeta

      if (!allFilesMeta || !Array.isArray(allFilesMeta)) {
        return NextResponse.json({ error: 'Invalid data format' }, { status: 400 })
      }

      // [新增] 唯一性校验：检查是否有重复的 Path
      const pathSet = new Set<string>()
      const duplicatePaths: string[] = []

      for (const file of allFilesMeta) {
        // 检查 path 是否已存在
        if (pathSet.has(file.path)) {
          duplicatePaths.push(file.path)
        } else {
          pathSet.add(file.path)
        }
      }

      // [策略选择]：直接抛错给客户端
      if (duplicatePaths.length > 0) {
        console.error('Duplicate paths detected:', duplicatePaths)
        return NextResponse.json(
          {
            error: 'Duplicate files detected',
            details: duplicatePaths
          },
          { status: 400 }
        )
      }

      // 重新排序
      allFilesMeta.sort((a, b) => a.order - b.order)

      // 执行数据库事务
      await updateArtworkImagesTransaction(artworkId, allFilesMeta)

      // 删除备份
      await fsPromises.rm(backupDir, { recursive: true, force: true }).catch(console.error)

      return NextResponse.json({ success: true })
    }

    // ==========================================
    // Phase 3: 回滚 (恢复备份)
    // ==========================================
    if (action === 'rollback') {
      // [安全检查] 必须存在备份目录才能回滚，否则可能误删文件
      if (!fs.existsSync(backupDir)) {
        return NextResponse.json({ error: 'No active backup session found (cannot rollback)' }, { status: 400 })
      }

      // 1. 删除当前目录下的所有媒体文件（这些是上传失败产生的新文件）
      const currentFiles = await fsPromises.readdir(targetDir)
      for (const f of currentFiles) {
        if (f === '.bak_session') continue
        await fsPromises.unlink(path.join(targetDir, f)).catch(() => {})
      }

      // 2. 将 .bak_session 里的东西移回来
      const backupFiles = await fsPromises.readdir(backupDir)
      for (const f of backupFiles) {
        await fsPromises.rename(path.join(backupDir, f), path.join(targetDir, f))
      }

      // 3. 删除备份目录
      await fsPromises.rm(backupDir, { recursive: true, force: true })

      return NextResponse.json({ success: true, message: 'Rolled back successfully' })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error: any) {
    console.error('API Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
