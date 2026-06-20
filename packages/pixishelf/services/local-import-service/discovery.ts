import 'server-only'

import fs from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { MEDIA_EXTENSIONS } from '@/lib/constant'
import { compareFileNamesNaturally } from '@/utils/artwork/natural-file-name-order'
import {
  canonicalizeLocalImportStoragePath,
  LOCAL_IMPORT_DIRECTORY,
  LOCAL_IMPORT_ROOT_DISPLAY,
  localImportDiscoveryInputSchema,
  type LocalImportArtistItem,
  type LocalImportDiscoveryInput,
  type LocalImportDiscoveryResult,
  type LocalImportWorkItem
} from '@/schemas/local-import.dto'

const supportedMediaExtensions = new Set(MEDIA_EXTENSIONS)

export async function discoverLocalImports(input: LocalImportDiscoveryInput): Promise<LocalImportDiscoveryResult> {
  const { scanPath } = localImportDiscoveryInputSchema.parse(input)
  const importRoot = path.resolve(scanPath, LOCAL_IMPORT_DIRECTORY)
  const db = prisma as any
  const [existingRows, mappingRows] = await Promise.all([
    db.artwork.findMany({
      where: { storagePath: { not: null } },
      select: { storagePath: true }
    }),
    db.localImportArtistMapping.findMany({
      include: { artist: { select: { id: true, name: true } } }
    })
  ])
  const existingPaths = new Set<string>()
  for (const row of existingRows as Array<{ storagePath: string | null }>) {
    if (!row.storagePath) continue
    try {
      existingPaths.add(canonicalizeLocalImportStoragePath(row.storagePath))
    } catch {
      // Ignore legacy invalid paths; they cannot match a canonical candidate.
    }
  }
  const mappings = new Map(
    (mappingRows as Array<{ artistDirectory: string; artistId: number; artist: { name: string } }>).map((row) => [
      row.artistDirectory,
      { artistId: row.artistId, artistName: row.artist.name }
    ])
  )

  const artistEntries = await readDirectories(importRoot)
  const artists: LocalImportArtistItem[] = []
  for (const artistEntry of artistEntries) {
    const artistDirectory = artistEntry.name
    const artistPath = path.join(importRoot, artistDirectory)
    const workEntries = await readDirectories(artistPath)
    const works: LocalImportWorkItem[] = []

    for (const workEntry of workEntries) {
      const workDirectory = workEntry.name
      const storagePath = canonicalizeLocalImportStoragePath(
        path.posix.join(LOCAL_IMPORT_DIRECTORY, artistDirectory, workDirectory)
      )
      if (existingPaths.has(storagePath)) {
        works.push({ workDirectory, title: workDirectory, storagePath, status: 'existing', mediaFiles: [], mediaCount: 0 })
        continue
      }

      try {
        const entries = await fs.readdir(path.join(artistPath, workDirectory), { withFileTypes: true })
        const mediaFiles = entries
          .filter(
            (entry) =>
              entry.isFile() && !entry.name.startsWith('.') && supportedMediaExtensions.has(path.extname(entry.name).toLowerCase())
          )
          .map((entry) => entry.name)
          .sort(compareFileNamesNaturally)
        works.push({
          workDirectory,
          title: workDirectory,
          storagePath,
          status: mediaFiles.length > 0 ? 'new' : 'invalid',
          mediaFiles,
          mediaCount: mediaFiles.length,
          ...(mediaFiles.length === 0 ? { error: 'No supported direct media files' } : {})
        })
      } catch (error) {
        works.push({
          workDirectory,
          title: workDirectory,
          storagePath,
          status: 'invalid',
          mediaFiles: [],
          mediaCount: 0,
          error: errorMessage(error)
        })
      }
    }

    artists.push({
      artistDirectory,
      mapping: mappings.get(artistDirectory) ?? null,
      works
    })
  }

  const allWorks = artists.flatMap((artist) => artist.works)
  return {
    importRoot,
    importRootDisplay: LOCAL_IMPORT_ROOT_DISPLAY,
    artists,
    counts: {
      artists: artists.length,
      works: allWorks.length,
      new: allWorks.filter((work) => work.status === 'new').length,
      existing: allWorks.filter((work) => work.status === 'existing').length,
      invalid: allWorks.filter((work) => work.status === 'invalid').length,
      media: allWorks.reduce((sum, work) => sum + work.mediaCount, 0)
    }
  }
}

async function readDirectories(directory: string) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}
