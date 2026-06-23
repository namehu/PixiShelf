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
    const works = await discoverArtistWorks({
      artistDirectory,
      artistPath,
      existingPaths
    })

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

async function discoverArtistWorks(input: {
  artistDirectory: string
  artistPath: string
  existingPaths: Set<string>
}): Promise<LocalImportWorkItem[]> {
  const works: LocalImportWorkItem[] = []
  await visitWorkDirectory({
    ...input,
    relativeDirectorySegments: [],
    works
  })
  return works.sort((a, b) => a.relativeDirectory.localeCompare(b.relativeDirectory))
}

async function visitWorkDirectory(input: {
  artistDirectory: string
  artistPath: string
  relativeDirectorySegments: string[]
  existingPaths: Set<string>
  works: LocalImportWorkItem[]
}) {
  const { artistDirectory, artistPath, relativeDirectorySegments, existingPaths, works } = input
  const currentPath = path.join(artistPath, ...relativeDirectorySegments)
  let currentWork:
    | {
        workDirectory: string
        relativeDirectory: string
        storagePath: string
      }
    | null = null

  if (relativeDirectorySegments.length > 0) {
    const relativeDirectory = relativeDirectorySegments.join('/')
    const workDirectory = relativeDirectorySegments[relativeDirectorySegments.length - 1]!
    const storagePath = canonicalizeLocalImportStoragePath(
      path.posix.join(LOCAL_IMPORT_DIRECTORY, artistDirectory, relativeDirectory)
    )

    currentWork = { workDirectory, relativeDirectory, storagePath }
    if (existingPaths.has(storagePath)) {
      works.push({
        workDirectory,
        relativeDirectory,
        title: workDirectory,
        storagePath,
        status: 'existing',
        mediaFiles: [],
        mediaCount: 0
      })
      return
    }
  }

  const entries = await readVisibleEntries(currentPath)
  const childDirectories = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name))

  if (currentWork) {
    const mediaFiles = entries
      .filter((entry) => entry.isFile() && supportedMediaExtensions.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      .sort(compareFileNamesNaturally)

    if (mediaFiles.length > 0) {
      works.push({
        workDirectory: currentWork.workDirectory,
        relativeDirectory: currentWork.relativeDirectory,
        title: currentWork.workDirectory,
        storagePath: currentWork.storagePath,
        status: 'new',
        mediaFiles,
        mediaCount: mediaFiles.length
      })
    }
  }

  for (const childDirectory of childDirectories) {
    await visitWorkDirectory({
      artistDirectory,
      artistPath,
      relativeDirectorySegments: [...relativeDirectorySegments, childDirectory.name],
      existingPaths,
      works
    })
  }
}

async function readDirectories(directory: string) {
  try {
    const entries = await readVisibleEntries(directory)
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function readVisibleEntries(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  return entries.filter((entry) => !entry.name.startsWith('.'))
}
