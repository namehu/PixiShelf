// oxlint-disable max-nested-callbacks
import fs from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import { MEDIA_EXTENSIONS } from '@/lib/constant'
import { getSystemSettings } from '@/services/setting.service'
import { isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'
import { determineArtworkRelDir } from './utils'
import { ImageMeta, ReplaceChapterMetaInput, updateArtworkImagesTransaction } from './image-manager'

// 定义 API 支持的操作类型
export type ImageReplaceActionType = 'init' | 'commit' | 'rollback'

export type ImageReplaceSessionInput = {
  scanRoot: string
  artworkId: number
  artwork: {
    storagePath?: string | null
    images?: { path: string }[]
    artist?: { userId: string | null } | null
    externalId: string | null
  }
  action: ImageReplaceActionType
  readBody?: () => Promise<any>
}

export type ImageReplaceSessionResult =
  | {
      success: true
      message: 'Initialized & Backed up'
      uploadTargetDir: string
      targetRelDir: string
    }
  | {
      success: true
    }
  | {
      success: true
      message: 'Rolled back successfully'
    }

export class ImageReplaceSessionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'ImageReplaceSessionError'
  }
}

export function createImageReplaceSessionPaths(scanRoot: string, artwork: ImageReplaceSessionInput['artwork']) {
  // 2. 确定路径
  const targetRelDir = determineArtworkRelDir(artwork)

  if (!targetRelDir) {
    throw new ImageReplaceSessionError('Cannot determine path', 400)
  }

  const targetDir = path.join(scanRoot, targetRelDir)
  const backupDir = path.join(targetDir, `.bak_session`) // 固定备份目录名，方便会话内复用

  return { targetRelDir, targetDir, backupDir }
}

export async function handleImageReplaceSession(input: ImageReplaceSessionInput): Promise<ImageReplaceSessionResult> {
  const { targetRelDir, targetDir, backupDir } = createImageReplaceSessionPaths(input.scanRoot, input.artwork)

  // ==========================================
  // Phase 1: 初始化 (备份旧文件)
  // ==========================================
  if (input.action === 'init') {
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
          if (MEDIA_EXTENSIONS.includes(ext) || isChapterManifestFileName(f)) {
            await fsPromises.rename(path.join(targetDir, f), path.join(backupDir, f))
          }
        }
      }
    }

    return {
      success: true,
      message: 'Initialized & Backed up',
      uploadTargetDir: targetDir,
      targetRelDir
    }
  }

  // ==========================================
  // Phase 2: 提交 (数据库更新 & 清理)
  // ==========================================
  if (input.action === 'commit') {
    const body = input.readBody ? await input.readBody() : {}
    const allFilesMeta: ImageMeta[] = body.filesMeta
    const chaptersMeta: ReplaceChapterMetaInput[] = Array.isArray(body.chaptersMeta) ? body.chaptersMeta : []

    if (!allFilesMeta || !Array.isArray(allFilesMeta)) {
      throw new ImageReplaceSessionError('Invalid data format', 400)
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
      throw new ImageReplaceSessionError('Duplicate files detected', 400, duplicatePaths)
    }

    // 重新排序
    allFilesMeta.sort((a, b) => a.order - b.order)

    const videoFileNameSet = new Set(allFilesMeta.map((file) => file.fileName))
    const unmatchedChapterFiles = chaptersMeta
      .filter((item) => !videoFileNameSet.has(item.videoFileName))
      .map((item) => item.chaptersFileName)

    if (unmatchedChapterFiles.length > 0) {
      throw new ImageReplaceSessionError('Unmatched chapter files detected', 400, unmatchedChapterFiles)
    }

    const systemSettings = await getSystemSettings()

    // 执行数据库事务
    await updateArtworkImagesTransaction(input.artworkId, allFilesMeta, chaptersMeta, {
      appendTagIds: systemSettings.replace_default_tag_ids
    })

    // 删除备份
    await fsPromises.rm(backupDir, { recursive: true, force: true }).catch(console.error)

    return { success: true }
  }

  // ==========================================
  // Phase 3: 回滚 (恢复备份)
  // ==========================================
  if (input.action === 'rollback') {
    // [安全检查] 必须存在备份目录才能回滚，否则可能误删文件
    if (!fs.existsSync(backupDir)) {
      throw new ImageReplaceSessionError('No active backup session found (cannot rollback)', 400)
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

    return { success: true, message: 'Rolled back successfully' }
  }

  throw new ImageReplaceSessionError('Unknown action', 400)
}
