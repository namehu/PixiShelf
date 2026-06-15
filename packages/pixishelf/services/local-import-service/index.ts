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

  for (let index = 0; index < candidates.length; index += 1) {
    await throwIfCancelled(input.checkCancelled)
    const candidate = candidates[index]!
    const artistId = mappingByDirectory.get(candidate.artistDirectory)
    if (!artistId) {
      result.failed += 1
      addError(result.errors, `${candidate.artistDirectory}/${candidate.work.workDirectory}: Artist is not mapped`)
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
      addError(result.errors, `${candidate.artistDirectory}/${candidate.work.workDirectory}: ${message}`)
      await reportProgress({ input, candidate, index, total: candidates.length, status: 'failed', message })
    }
  }

  result.processingTime = Date.now() - startTime
  return result
}

async function reportProgress(options: {
  input: RunLocalImportInput
  candidate: { artistDirectory: string; work: { workDirectory: string } }
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
    status,
    ...(message ? { message } : {})
  })
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
