// oxlint-disable max-nested-callbacks
import fs from 'fs'
import type { BigIntStats } from 'fs'
import fsPromises from 'fs/promises'
import path from 'path'
import { MEDIA_EXTENSIONS } from '@/lib/constant'
import { getSystemSettings } from '@/services/setting.service'
import { isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'
import { determineArtworkRelDir } from './utils'
import { ImageMeta, ReplaceChapterMetaInput, updateArtworkImagesTransaction } from './image-manager'
import {
  beginAnimationReplaceSessionWrite,
  captureAnimationReplaceRollbackWriteTokens,
  finishAnimationSourcePathWrite
} from './animation-source-guard'
import { ReplaceWriteBusyError, withReplaceWriteLock } from './replace-write-lock'

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
  await fsPromises.mkdir(targetDir, { recursive: true })
  try {
    return await withReplaceWriteLock(targetDir, () =>
      handleImageReplaceSessionLocked(input, targetRelDir, targetDir, backupDir)
    )
  } catch (error) {
    if (error instanceof ReplaceWriteBusyError) throw new ImageReplaceSessionError(error.message, 409)
    throw error
  }
}

async function handleImageReplaceSessionLocked(
  input: ImageReplaceSessionInput,
  targetRelDir: string,
  targetDir: string,
  backupDir: string
): Promise<ImageReplaceSessionResult> {

  // ==========================================
  // 阶段 1：初始化（备份旧文件）
  // ==========================================
  if (input.action === 'init') {
    await beginAnimationReplaceSessionWrite(input.artworkId)
    await fsPromises.mkdir(backupDir, { recursive: true })
    await assertBackupDirectory(backupDir)
    const manifest = await getOrCreateReplaceManifest(targetDir, backupDir)
    if (manifest.phase === 'ROLLING_BACK' || manifest.phase === 'COMMITTING') {
      throw new ImageReplaceSessionError('Replace session is already being finalized', 409)
    }
    for (const fileName of manifest.originalFiles) {
      const backupFile = path.join(backupDir, fileName)
      if (await pathEntryExists(backupFile)) {
        await assertOriginalIdentity(backupFile, manifest, fileName, false)
        continue
      }
      const originalFile = path.join(targetDir, fileName)
      await assertOriginalIdentity(originalFile, manifest, fileName, true)
      await fsPromises.rename(originalFile, backupFile)
    }
    manifest.phase = 'READY'
    await writeReplaceManifest(backupDir, manifest)

    return {
      success: true,
      message: 'Initialized & Backed up',
      uploadTargetDir: targetDir,
      targetRelDir
    }
  }

  // ==========================================
  // 阶段 2：提交（数据库更新与清理）
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

    const manifest = await readReplaceManifest(backupDir)
    if (manifest.phase !== 'READY') {
      throw new ImageReplaceSessionError('Replace commit state is incomplete or unknown; inspect database and media before recovery', 409)
    }
    manifest.phase = 'COMMITTING'
    await writeReplaceManifest(backupDir, manifest)
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
  // 阶段 3：回滚（恢复备份）
  // ==========================================
  if (input.action === 'rollback') {
    // [安全检查] 必须存在备份目录才能回滚，否则可能误删文件
    if (!fs.existsSync(backupDir)) {
      throw new ImageReplaceSessionError('No active backup session found (cannot rollback)', 400)
    }
    await assertBackupDirectory(backupDir)
    const manifest = await readReplaceManifest(backupDir)
    if (manifest.phase === 'COMMITTING') {
      throw new ImageReplaceSessionError('Replace commit state is unknown; automatic rollback is unsafe', 409)
    }
    const writeTokens = await captureAnimationReplaceRollbackWriteTokens(input.artworkId)
    const backupFiles = (await fsPromises.readdir(backupDir)).filter(isReplaceMediaFile)
    const backedUpNames = new Set(backupFiles)
    const originalNames = new Set(manifest.originalFiles)
    if (backupFiles.some((fileName) => !originalNames.has(fileName))) {
      throw new ImageReplaceSessionError('Replace backup contains an unrecorded media file', 409)
    }
    for (const fileName of manifest.originalFiles) {
      const backupFile = path.join(backupDir, fileName)
      const targetFile = path.join(targetDir, fileName)
      if (await pathEntryExists(backupFile)) await assertOriginalIdentity(backupFile, manifest, fileName, false)
      else await assertOriginalIdentity(targetFile, manifest, fileName, true)
    }

    manifest.phase = 'ROLLING_BACK'
    await writeReplaceManifest(backupDir, manifest)

    // An interrupted init may leave an original in the target directory. Preserve it.
    const currentFiles = await fsPromises.readdir(targetDir)
    for (const f of currentFiles) {
      if (!isReplaceMediaFile(f)) continue
      if (originalNames.has(f) && !backedUpNames.has(f)) continue
      await fsPromises.unlink(path.join(targetDir, f))
    }

    // Restore each original that was already moved into the backup.
    for (const f of backupFiles) {
      manifest.restoringFiles ??= []
      if (!manifest.restoringFiles.includes(f)) {
        manifest.restoringFiles.push(f)
        await writeReplaceManifest(backupDir, manifest)
      }
      await fsPromises.rename(path.join(backupDir, f), path.join(targetDir, f))
    }

    // 3. 删除备份目录
    await fsPromises.rm(backupDir, { recursive: true, force: true })

    await finishAnimationSourcePathWrite(writeTokens)

    return { success: true, message: 'Rolled back successfully' }
  }

  throw new ImageReplaceSessionError('Unknown action', 400)
}

interface ReplaceManifest {
  version: 1
  originalFiles: string[]
  originalStates?: Record<string, ReplaceFileState>
  phase?: 'BACKING_UP' | 'READY' | 'ROLLING_BACK' | 'COMMITTING'
  restoringFiles?: string[]
}

interface ReplaceFileState {
  size: string
  mtimeNs: string
  ctimeNs: string
  deviceId: string
  inode: string
}

const replaceManifestName = '.session-manifest.json'
const replaceManifestTempName = '.session-manifest.tmp'

function isReplaceMediaFile(name: string) {
  if (name === '.bak_session' || path.basename(name) !== name) return false
  return MEDIA_EXTENSIONS.includes(path.extname(name).toLowerCase()) || isChapterManifestFileName(name)
}

async function getOrCreateReplaceManifest(targetDir: string, backupDir: string): Promise<ReplaceManifest> {
  const manifestPath = path.join(backupDir, replaceManifestName)
  if (fs.existsSync(manifestPath)) return readReplaceManifest(backupDir)
  const backupEntries = (await fsPromises.readdir(backupDir)).filter((name) => name !== replaceManifestTempName)
  if (backupEntries.length > 0) {
    throw new ImageReplaceSessionError('Replace backup has no manifest; restore manually before continuing', 409)
  }
  const manifest: ReplaceManifest = {
    version: 1,
    originalFiles: (await fsPromises.readdir(targetDir)).filter(isReplaceMediaFile),
    originalStates: {},
    phase: 'BACKING_UP',
    restoringFiles: []
  }
  for (const name of manifest.originalFiles) {
    const stats = await fsPromises.lstat(path.join(targetDir, name), { bigint: true })
    if (!stats.isFile()) throw new ImageReplaceSessionError('Replace original is not a regular file', 409)
    manifest.originalStates![name] = fileState(stats)
  }
  await writeReplaceManifest(backupDir, manifest)
  return manifest
}

async function writeReplaceManifest(backupDir: string, manifest: ReplaceManifest) {
  await fsPromises.writeFile(path.join(backupDir, replaceManifestTempName), JSON.stringify(manifest), { flag: 'w' })
  await fsPromises.rename(path.join(backupDir, replaceManifestTempName), path.join(backupDir, replaceManifestName))
}

async function assertBackupDirectory(backupDir: string) {
  const stats = await fsPromises.lstat(backupDir)
  if (!stats.isDirectory()) throw new ImageReplaceSessionError('Replace backup directory is not a regular directory', 409)
}

async function readReplaceManifest(backupDir: string): Promise<ReplaceManifest> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await fsPromises.readFile(path.join(backupDir, replaceManifestName), 'utf8'))
  } catch {
    throw new ImageReplaceSessionError('Replace backup manifest is missing or damaged', 409)
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    parsed.version !== 1 ||
    !('originalFiles' in parsed) ||
    !Array.isArray(parsed.originalFiles) ||
    !parsed.originalFiles.every((name) => typeof name === 'string' && isReplaceMediaFile(name)) ||
    new Set(parsed.originalFiles).size !== parsed.originalFiles.length ||
    ('originalStates' in parsed && !validOriginalStates(parsed.originalStates, parsed.originalFiles)) ||
    ('phase' in parsed && !['BACKING_UP', 'READY', 'ROLLING_BACK', 'COMMITTING'].includes(parsed.phase as string)) ||
    ('restoringFiles' in parsed && (
      !Array.isArray(parsed.restoringFiles) ||
      !parsed.restoringFiles.every((name) => typeof name === 'string' && (parsed.originalFiles as string[]).includes(name)) ||
      new Set(parsed.restoringFiles).size !== parsed.restoringFiles.length
    ))
  ) {
    throw new ImageReplaceSessionError('Replace backup manifest is invalid', 409)
  }
  return parsed as ReplaceManifest
}

function fileState(stats: BigIntStats): ReplaceFileState {
  return {
    size: String(stats.size), mtimeNs: String(stats.mtimeNs), ctimeNs: String(stats.ctimeNs),
    deviceId: String(stats.dev), inode: String(stats.ino)
  }
}

async function pathEntryExists(filePath: string) {
  try {
    await fsPromises.lstat(filePath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
}

function validOriginalStates(value: unknown, names: string[]): value is Record<string, ReplaceFileState> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const states = value as Record<string, ReplaceFileState>
  if (Object.keys(states).length !== names.length) return false
  return names.every((name) => {
    const state = states[name]
    return state && ['size', 'mtimeNs', 'ctimeNs', 'deviceId', 'inode'].every(
      (key) => typeof state[key as keyof ReplaceFileState] === 'string' && /^\d+$/.test(state[key as keyof ReplaceFileState])
    )
  })
}

async function assertOriginalIdentity(filePath: string, manifest: ReplaceManifest, fileName: string, unmoved: boolean) {
  let stats: BigIntStats
  try {
    stats = await fsPromises.lstat(filePath, { bigint: true })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new ImageReplaceSessionError('An original media file is missing from the replace backup', 409)
    }
    throw error
  }
  if (!stats.isFile()) throw new ImageReplaceSessionError('Replace original is not a regular file', 409)
  const expected = manifest.originalStates?.[fileName]
  // A legacy name-only manifest cannot prove that an unmoved target is still the original.
  if (!expected && unmoved) throw new ImageReplaceSessionError('Unmoved legacy replace original needs manual recovery', 409)
  if (!expected) return
  const actual = fileState(stats)
  if (
    expected.size !== actual.size || expected.deviceId !== actual.deviceId || expected.inode !== actual.inode ||
    expected.mtimeNs !== actual.mtimeNs ||
    (unmoved && !manifest.restoringFiles?.includes(fileName) && expected.ctimeNs !== actual.ctimeNs)
  ) {
    throw new ImageReplaceSessionError('Replace original changed since its backup manifest was recorded', 409)
  }
}

/** Called while holding the directory lock, before any upload can truncate an original. */
export async function assertReplaceBackupProtectsUpload(targetDir: string, fileName: string) {
  const backupDir = path.join(targetDir, '.bak_session')
  if (!(await pathEntryExists(backupDir))) return
  await assertBackupDirectory(backupDir)
  const manifest = await readReplaceManifest(backupDir)
  if (manifest.phase !== 'READY') {
    throw new ImageReplaceSessionError('Replace backup is not ready for media uploads', 409)
  }
  if (!manifest.originalFiles.includes(fileName)) return
  await assertOriginalIdentity(path.join(backupDir, fileName), manifest, fileName, false)
}
