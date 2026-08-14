import * as fs from 'node:fs/promises'
import path from 'node:path'
import type { MaintenanceOperationInput } from './types.js'
import { throwIfMaintenanceAborted } from './types.js'

export const REFILL_META_SOURCE_BATCH_SIZE = 100

export interface RefillMetaSourceResult {
  updatedCount: number
  totalFiles: number
  missingMetadataFiles: number
  unsafePaths: number
}

export async function refillMetaSource(
  input: MaintenanceOperationInput & { scanRoot: string }
): Promise<RefillMetaSourceResult> {
  const canonicalRoot = await fs.realpath(input.scanRoot)
  const totalFiles = await input.database.artwork.count({
    where: { metaSource: null, externalId: { not: null } }
  })
  let cursor = 0
  let processed = 0
  let updatedCount = 0
  let missingMetadataFiles = 0
  let unsafePaths = 0

  await input.progress({
    percentage: totalFiles === 0 ? 100 : 1,
    stage: 'DISCOVERING',
    message: totalFiles === 0 ? '没有需要补全元数据源的作品' : `发现 ${totalFiles} 个待处理作品`,
    data: { total: totalFiles }
  })

  while (true) {
    throwIfMaintenanceAborted(input.signal)
    const artworks = await input.database.artwork.findMany({
      where: { id: { gt: cursor }, metaSource: null, externalId: { not: null } },
      orderBy: { id: 'asc' },
      take: REFILL_META_SOURCE_BATCH_SIZE,
      select: {
        id: true,
        externalId: true,
        images: { take: 1, select: { path: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }
      }
    })
    if (artworks.length === 0) break
    cursor = artworks.at(-1)!.id

    const candidates: Array<{ artworkId: number; metaSource: string }> = []
    for (const artwork of artworks) {
      throwIfMaintenanceAborted(input.signal)
      const imagePath = artwork.images[0]?.path
      if (!artwork.externalId || !imagePath) {
        missingMetadataFiles += 1
        continue
      }
      try {
        const metaSource = await resolveMetadataSource(canonicalRoot, imagePath, artwork.externalId)
        if (metaSource) candidates.push({ artworkId: artwork.id, metaSource })
        else missingMetadataFiles += 1
      } catch (error) {
        if (error instanceof UnsafeMaintenancePathError) unsafePaths += 1
        else throw error
      }
    }

    if (candidates.length > 0) {
      const updated = await input.mutate(async (transaction) => {
        let count = 0
        for (const candidate of candidates) {
          const result = await transaction.artwork.updateMany({
            where: { id: candidate.artworkId, metaSource: null },
            data: { metaSource: candidate.metaSource }
          })
          count += result.count
        }
        return count
      })
      updatedCount += updated
    }

    processed += artworks.length
    await input.progress({
      percentage: Math.min(99, 1 + Math.floor((processed / Math.max(1, totalFiles)) * 98)),
      stage: 'REFILLING',
      message: `已检查 ${processed}/${totalFiles} 个作品，更新 ${updatedCount} 个`,
      data: { total: totalFiles, processed, updatedCount, missingMetadataFiles, unsafePaths }
    })
  }

  throwIfMaintenanceAborted(input.signal)
  await input.progress({
    percentage: 100,
    stage: 'COMPLETED',
    message: `元数据源补全完成，更新 ${updatedCount} 个作品`,
    data: { total: totalFiles, updatedCount, missingMetadataFiles, unsafePaths }
  })
  return { updatedCount, totalFiles, missingMetadataFiles, unsafePaths }
}

async function resolveMetadataSource(
  canonicalRoot: string,
  imageRelativePath: string,
  externalId: string
): Promise<string | null> {
  const metadataFilename = `${externalId}-meta.txt`
  if (path.basename(metadataFilename) !== metadataFilename || metadataFilename.includes('\0')) {
    throw new UnsafeMaintenancePathError('Metadata filename contains path separators')
  }
  const imagePath = resolveLexicallyWithinRoot(canonicalRoot, imageRelativePath)
  const candidate = path.join(path.dirname(imagePath), metadataFilename)
  assertWithinRoot(canonicalRoot, candidate)
  let canonicalCandidate: string
  try {
    canonicalCandidate = await fs.realpath(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  assertWithinRoot(canonicalRoot, canonicalCandidate)
  const stat = await fs.stat(canonicalCandidate)
  if (!stat.isFile()) return null
  return path.relative(canonicalRoot, canonicalCandidate).replace(/\\/g, '/')
}

function resolveLexicallyWithinRoot(root: string, relativePath: string): string {
  const candidate = path.resolve(root, relativePath.replace(/^[/\\]+/, ''))
  assertWithinRoot(root, candidate)
  return candidate
}

function assertWithinRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return
  throw new UnsafeMaintenancePathError('Path is outside the configured scan root')
}

export class UnsafeMaintenancePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeMaintenancePathError'
  }
}
