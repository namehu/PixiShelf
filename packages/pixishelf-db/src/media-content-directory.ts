import { Prisma } from '@prisma/client'
import type {
  MediaContentDirectoryKey,
  MediaContentDirectorySnapshot,
  MediaContentResult,
  MediaContentTransaction
} from './media-content-types'
import { MediaContentConflictError } from './media-content-types'
import { directorySnapshot, lockContentDirectories } from './media-content-common'

export async function contentDirectoryHasWriter(tx: MediaContentTransaction, directory: MediaContentDirectorySnapshot) {
  return contentDirectoriesHaveWriter(tx, [directory])
}
export async function contentDirectoriesHaveWriter(
  tx: MediaContentTransaction,
  directories: readonly MediaContentDirectorySnapshot[]
) {
  if (!directories.length) return false
  const conditions = directories.map(
    (d) =>
      Prisma.sql`(r."logicalRoot" = ${d.logicalRoot} AND ((w.scope = 'PATH' AND (${d.relativeDirectory} = '' OR left(w."relativePath", length(${d.relativeDirectory}) + 1) = ${d.relativeDirectory} || '/')) OR (w.scope = 'DIRECTORY' AND (${d.relativeDirectory} = '' OR r."relativeDirectory" = '' OR r."relativeDirectory" = ${d.relativeDirectory} OR left(${d.relativeDirectory}, length(r."relativeDirectory") + 1) = r."relativeDirectory" || '/' OR left(r."relativeDirectory", length(${d.relativeDirectory}) + 1) = ${d.relativeDirectory} || '/'))))`
  )
  const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(
    Prisma.sql`SELECT EXISTS(SELECT 1 FROM "MediaContentPathWrite" w JOIN "MediaContentDirectoryState" r ON r.id = w."directoryId" WHERE w.status IN ('ACTIVE','READY','RECOVERY_REQUIRED') AND (${Prisma.join(conditions, ' OR ')})) AS "exists"`
  )
  return rows[0]!.exists
}

export async function captureMediaContentDirectory(
  tx: MediaContentTransaction,
  input: { directory: MediaContentDirectoryKey }
): Promise<MediaContentResult<MediaContentDirectorySnapshot>> {
  try {
    const rows = await lockContentDirectories(tx, [input.directory])
    const snapshot = directorySnapshot(
      rows.get(`${input.directory.logicalRoot}\0${input.directory.relativeDirectory}`)!
    )
    if (await contentDirectoryHasWriter(tx, snapshot)) return { status: 'WRITING' }
    return { status: 'READY', value: snapshot }
  } catch (error) {
    if (error instanceof MediaContentConflictError) return { status: error.status }
    throw error
  }
}

export async function assertMediaContentDirectorySnapshot(
  tx: MediaContentTransaction,
  input: { snapshot: MediaContentDirectorySnapshot }
): Promise<MediaContentResult<MediaContentDirectorySnapshot>> {
  const result = await captureMediaContentDirectory(tx, { directory: input.snapshot })
  if (result.status !== 'READY') return result
  if (result.value.directoryId !== input.snapshot.directoryId || result.value.generation !== input.snapshot.generation)
    return { status: 'STALE' }
  return result
}
