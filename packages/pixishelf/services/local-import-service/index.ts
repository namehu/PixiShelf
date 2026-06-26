import 'server-only'

import { prisma } from '@/lib/prisma'
import { scanLocalArtworkMediaDirectory } from '@/services/artwork-service/local-media-scanner'
import { updateArtworkImagesWithTransactionClient } from '@/services/artwork-service/image-manager'
import { generateLocalExternalId } from '@/services/artwork-service/utils'
import {
  localImportDiscoveryInputSchema,
  saveLocalImportArtistMappingSchema,
  saveLocalImportArtistMappingsSchema,
  type LocalImportRunResult,
  type RunLocalImportInput,
  type SaveLocalImportArtistMappingInput,
  type SaveLocalImportArtistMappingsInput
} from '@/schemas/local-import.dto'
import { discoverLocalImports } from './discovery'
import { ESource } from '@/enums/ESource'

const MAX_ERRORS = 200

export { discoverLocalImports } from './discovery'
export * from '@/schemas/local-import.dto'

export async function getLocalImportArtistMappings() {
  const db = prisma as any
  return db.localImportArtistMapping.findMany({
    include: { artist: true },
    orderBy: { artistDirectory: 'asc' }
  })
}

export async function saveLocalImportArtistMapping(input: SaveLocalImportArtistMappingInput) {
  const data = saveLocalImportArtistMappingSchema.parse(input)
  const db = prisma as any
  const artist = await db.artist.findUnique({ where: { id: data.artistId }, select: { id: true } })
  if (!artist) throw new Error('Artist not found')

  return db.localImportArtistMapping.upsert({
    where: { artistDirectory: data.artistDirectory },
    create: data,
    update: { artistId: data.artistId },
    include: { artist: true }
  })
}

export async function saveLocalImportArtistMappings(input: SaveLocalImportArtistMappingsInput) {
  const data = saveLocalImportArtistMappingsSchema.parse(input)
  return Promise.all(data.mappings.map((mapping) => saveLocalImportArtistMapping(mapping)))
}

export async function runLocalImport(input: RunLocalImportInput): Promise<LocalImportRunResult> {
  const startTime = Date.now()
  const { scanPath } = localImportDiscoveryInputSchema.parse(input)
  await throwIfCancelled(input.checkCancelled)
  const discovery = await discoverLocalImports({ scanPath })
  const mappings = await getLocalImportArtistMappings()
  const mappingByDirectory = new Map(
    (mappings as Array<{ artistDirectory: string; artistId: number }>).map((mapping) => [
      mapping.artistDirectory,
      mapping.artistId
    ])
  )
  const artistNameByDirectory = new Map(
    (
      mappings as Array<{
        artistDirectory: string
        artist?: { name?: string | null } | null
      }>
    ).map((mapping) => [mapping.artistDirectory, mapping.artist?.name ?? mapping.artistDirectory])
  )
  const candidates = discovery.artists.flatMap((artist) =>
    artist.works
      .filter((work) => work.status === 'new')
      .map((work) => ({ artistDirectory: artist.artistDirectory, work }))
  )
  const result: LocalImportRunResult = {
    total: discovery.counts.works,
    candidates: candidates.length,
    imported: 0,
    skipped: discovery.counts.existing + discovery.counts.invalid,
    failed: 0,
    newImages: 0,
    errors: [],
    processingTime: 0
  }

  const invalidAuditItems = discovery.artists.flatMap((artist) =>
    artist.works
      .filter((work) => work.status === 'invalid')
      .map((work) => ({
        title: work.title,
        artistName: artist.mapping?.artistName ?? artist.artistDirectory,
        relativeDirectory: work.storagePath,
        status: 'SKIPPED' as const,
        action: 'SKIP_INVALID_METADATA' as const,
        mediaCount: work.mediaCount,
        errorMessage: work.error ?? '目录结构无效',
        finishedAt: new Date()
      }))
  )
  if (invalidAuditItems.length > 0) {
    await input.audit?.recordItems?.(invalidAuditItems)
  }

  for (let index = 0; index < candidates.length; index += 1) {
    await throwIfCancelled(input.checkCancelled)
    const candidate = candidates[index]!
    const artistId = mappingByDirectory.get(candidate.artistDirectory)
    if (!artistId) {
      result.failed += 1
      addError(result.errors, `${getCandidateDisplayPath(candidate)}: Artist is not mapped`)
      await input.audit?.recordItems?.([
        buildLocalImportAuditItem(candidate, {
          artistName: candidate.artistDirectory,
          status: 'FAILED',
          action: 'FAILED_WRITE',
          errorMessage: 'Artist is not mapped'
        })
      ])
      await reportProgress({ input, candidate, index, total: candidates.length, status: 'failed', message: 'Artist is not mapped' })
      continue
    }

    const db = prisma as any
    const existing = await db.artwork.findUnique({
      where: { storagePath: candidate.work.storagePath },
      select: { id: true }
    })
    if (existing) {
      result.skipped += 1
      await reportProgress({ input, candidate, index, total: candidates.length, status: 'skipped', message: 'Artwork already exists' })
      continue
    }

    try {
      const media = await scanLocalArtworkMediaDirectory({
        scanPath,
        targetDirectoryRelativePath: candidate.work.storagePath,
        checkCancelled: input.checkCancelled
      })
      if (media.filesMeta.length === 0 || !media.earliestMediaMtime) {
        throw new Error('No valid media files found')
      }

      let createdExternalId: string | null = null
      await db.$transaction(async (tx: any) => {
        const artwork = await tx.artwork.create({
          data: {
            title: candidate.work.title,
            artistId,
            source: ESource.LOCAL_IMPORT,
            sourceDate: media.earliestMediaMtime,
            storagePath: candidate.work.storagePath
          },
          select: { id: true }
        })
        const externalId = generateLocalExternalId(artwork.id)
        createdExternalId = externalId
        await tx.artwork.update({ where: { id: artwork.id }, data: { externalId } })
        await updateArtworkImagesWithTransactionClient(
          tx,
          artwork.id,
          media.filesMeta,
          media.chaptersMeta,
          { appendTagIds: input.defaultTagIds }
        )
      })
      result.imported += 1
      result.newImages += media.filesMeta.length
      await input.audit?.recordItems?.([
        buildLocalImportAuditItem(candidate, {
          externalId: createdExternalId,
          artistName: artistNameByDirectory.get(candidate.artistDirectory),
          status: 'SUCCESS',
          action: 'CREATE',
          mediaCount: media.filesMeta.length,
          newImageCount: media.filesMeta.length
        })
      ])
      await reportProgress({ input, candidate, index, total: candidates.length, status: 'imported' })
    } catch (error) {
      if (isCancellationError(error)) throw new Error('Task cancelled')
      if (isStoragePathUniqueRace(error)) {
        result.skipped += 1
        await reportProgress({ input, candidate, index, total: candidates.length, status: 'skipped', message: 'Artwork already exists' })
        continue
      }
      result.failed += 1
      const message = error instanceof Error ? error.message : 'Unknown error'
      addError(result.errors, `${getCandidateDisplayPath(candidate)}: ${message}`)
      await input.audit?.recordItems?.([
        buildLocalImportAuditItem(candidate, {
          artistName: artistNameByDirectory.get(candidate.artistDirectory),
          status: 'FAILED',
          action: message === 'No valid media files found' ? 'FAILED_COLLECT' : 'FAILED_WRITE',
          errorMessage: message
        })
      ])
      await reportProgress({ input, candidate, index, total: candidates.length, status: 'failed', message })
    }
  }

  result.processingTime = Date.now() - startTime
  return result
}

function buildLocalImportAuditItem(
  candidate: { artistDirectory: string; work: { title: string; storagePath: string; mediaCount?: number } },
  input: {
    externalId?: string | null
    artistName?: string | null
    status: 'SUCCESS' | 'SKIPPED' | 'FAILED'
    action: 'CREATE' | 'SKIP_EXISTING' | 'SKIP_INVALID_METADATA' | 'FAILED_COLLECT' | 'FAILED_WRITE'
    mediaCount?: number
    newImageCount?: number
    errorMessage?: string | null
  }
) {
  return {
    externalId: input.externalId ?? null,
    title: candidate.work.title,
    artistName: input.artistName ?? candidate.artistDirectory,
    relativeDirectory: candidate.work.storagePath,
    status: input.status,
    action: input.action,
    mediaCount: input.mediaCount ?? candidate.work.mediaCount ?? 0,
    newImageCount: input.newImageCount ?? 0,
    errorMessage: input.errorMessage ?? null,
    finishedAt: new Date()
  }
}

async function reportProgress(options: {
  input: RunLocalImportInput
  candidate: { artistDirectory: string; work: { workDirectory: string; relativeDirectory?: string } }
  index: number
  total: number
  status: 'imported' | 'skipped' | 'failed'
  message?: string
}) {
  const { input, candidate, index, total, status, message } = options
  await input.onProgress?.({
    current: index + 1,
    total,
    artistDirectory: candidate.artistDirectory,
    workDirectory: candidate.work.workDirectory,
    relativeDirectory: candidate.work.relativeDirectory ?? candidate.work.workDirectory,
    status,
    ...(message ? { message } : {})
  })
}

function getCandidateDisplayPath(candidate: {
  artistDirectory: string
  work: { workDirectory: string; relativeDirectory?: string }
}) {
  return `${candidate.artistDirectory}/${candidate.work.relativeDirectory ?? candidate.work.workDirectory}`
}

async function throwIfCancelled(checkCancelled?: () => Promise<boolean>) {
  if (await checkCancelled?.()) throw new Error('Task cancelled')
}

function isCancellationError(error: unknown) {
  return error instanceof Error && error.message === 'Task cancelled'
}

function isStoragePathUniqueRace(error: unknown) {
  if (!error || typeof error !== 'object' || (error as any).code !== 'P2002') return false
  const target = (error as any).meta?.target
  return Array.isArray(target) ? target.includes('storagePath') : String(target ?? '').includes('storagePath')
}

function addError(errors: string[], message: string) {
  if (errors.length < MAX_ERRORS) errors.push(message)
}
