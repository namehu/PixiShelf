import 'server-only'
import fs from 'fs/promises'
import path from 'path'
import type {
  PendingReplaceManifestFile,
  PendingReplaceMediaSnapshot,
  PendingReplaceTargetFileSnapshot
} from '@/schemas/pending-replace.dto'
import {
  assertDirectoryAbsent,
  assertFileAbsent,
  pathExists,
  removeEmptyDirectory
} from './executor-file-utils'
import { PendingReplaceLeaseLostError } from './executor-lease'
import { assertRollbackFileSnapshot } from './executor-snapshot'

export async function rollbackFailedItem(input: {
  pendingRoot: string
  sourceDirectoryName: string
  workAbsolute: string
  workSourceAbsolute: string
  normalizedAbsolute: string
  targetAbsolute: string
  backupAbsolute: string
  manifest: PendingReplaceManifestFile[]
  newMedia: PendingReplaceMediaSnapshot[]
  targetFiles: PendingReplaceTargetFileSnapshot[]
  sourceMovedToWork: boolean
  newFilesMayBeInTarget: boolean
  assertLease?: () => Promise<void>
  mutate?: <T>(mutation: () => Promise<T>) => Promise<T>
}) {
  const errors: string[] = []
  const pendingDestination = path.join(input.pendingRoot, input.sourceDirectoryName)
  const mutate = input.mutate ?? (async <T>(mutation: () => Promise<T>) => mutation())
  let restoreDirectory: string | null = null
  let restoreIntoWorkDirectory = false
  try {
    if (await pathExists(input.workSourceAbsolute)) {
      restoreDirectory = input.workSourceAbsolute
      restoreIntoWorkDirectory = true
    } else if (await pathExists(pendingDestination)) {
      restoreDirectory = pendingDestination
    } else if (input.sourceMovedToWork) {
      await mutate(() => fs.mkdir(input.workSourceAbsolute, { recursive: true }))
      restoreDirectory = input.workSourceAbsolute
      restoreIntoWorkDirectory = true
    }
    const moveBack = async (source: string, originalName: string) => {
      return mutate(async () => {
        if (!(await pathExists(source))) return false
        if (!restoreDirectory) {
          await fs.mkdir(input.workSourceAbsolute, { recursive: true })
          restoreDirectory = input.workSourceAbsolute
          restoreIntoWorkDirectory = true
        }
        const destination = path.join(restoreDirectory, originalName)
        await assertFileAbsent(destination, `待处理目录已存在同名文件: ${originalName}`)
        await fs.rename(source, destination)
        return true
      })
    }
    for (const media of input.newMedia) {
      await input.assertLease?.()
      const fromTarget = path.join(input.targetAbsolute, media.targetName)
      const fromNormalized = path.join(input.normalizedAbsolute, media.targetName)
      if (input.newFilesMayBeInTarget && (await moveBack(fromTarget, media.sourceName))) continue
      await moveBack(fromNormalized, media.sourceName)
    }
    for (const chapter of input.manifest.filter((file) => file.kind === 'chapter' && file.targetName)) {
      await input.assertLease?.()
      const fromTarget = path.join(input.targetAbsolute, chapter.targetName!)
      const fromNormalized = path.join(input.normalizedAbsolute, chapter.targetName!)
      if (input.newFilesMayBeInTarget && (await moveBack(fromTarget, chapter.name))) continue
      await moveBack(fromNormalized, chapter.name)
    }
  } catch (error) {
    if (error instanceof PendingReplaceLeaseLostError) throw error
    errors.push(`恢复待替换源文件失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }
  try {
    await assertRollbackFileSnapshot(input.targetAbsolute, input.backupAbsolute, input.targetFiles)
    if (await pathExists(input.backupAbsolute)) {
      await mutate(() => fs.mkdir(input.targetAbsolute, { recursive: true }))
      for (const targetFile of input.targetFiles) {
        await input.assertLease?.()
        await mutate(async () => {
          const source = path.join(input.backupAbsolute, targetFile.name)
          if (!(await pathExists(source))) return
          const destination = path.join(input.targetAbsolute, targetFile.name)
          await assertFileAbsent(destination, `回滚目标已存在同名文件: ${targetFile.name}`)
          await fs.rename(source, destination)
        })
      }
      await mutate(() => removeEmptyDirectory(input.backupAbsolute))
      if (await pathExists(input.backupAbsolute)) {
        throw new Error(`应急备份目录仍有未识别文件: ${input.backupAbsolute}`)
      }
    }
  } catch (error) {
    if (error instanceof PendingReplaceLeaseLostError) throw error
    errors.push(`恢复旧媒体失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }
  try {
    await input.assertLease?.()
    if (restoreIntoWorkDirectory && (await pathExists(input.workSourceAbsolute))) {
      await mutate(async () => {
        await assertDirectoryAbsent(pendingDestination, '待处理目录已存在同名资源')
        await fs.rename(input.workSourceAbsolute, pendingDestination)
      })
    }
    await mutate(() => removeEmptyDirectory(input.normalizedAbsolute))
    await mutate(() => removeEmptyDirectory(input.workSourceAbsolute))
    await mutate(() => removeEmptyDirectory(input.workAbsolute))
    if (await pathExists(input.workAbsolute)) {
      errors.push(`工作目录仍有未恢复文件，请人工检查: ${input.workAbsolute}`)
    }
  } catch (error) {
    if (error instanceof PendingReplaceLeaseLostError) throw error
    errors.push(`恢复待处理目录失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }
  return errors
}
