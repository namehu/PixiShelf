import 'server-only'

import fs from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { MEDIA_EXTENSIONS } from '@/lib/constant'
import logger from '@/lib/logger'
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

interface LocalImportDiscoveryLimits {
  maxDepth: number
  maxEntries: number
  maxWorks: number
}

export const LOCAL_IMPORT_DISCOVERY_LIMITS: Readonly<LocalImportDiscoveryLimits> = Object.freeze({
  maxDepth: 12,
  maxEntries: 100_000,
  maxWorks: 10_000
})

interface LocalImportDiscoveryOptions {
  signal?: AbortSignal
  limits?: Partial<LocalImportDiscoveryLimits>
}

interface LocalImportDiscoveryState {
  signal?: AbortSignal
  limits: LocalImportDiscoveryLimits
  directoriesVisited: number
  entriesVisited: number
  worksDiscovered: number
  existingWorksPruned: number
  newWorks: number
}

export class LocalImportDiscoveryLimitError extends Error {
  constructor(
    public readonly limit: keyof LocalImportDiscoveryLimits,
    public readonly maximum: number
  ) {
    super(`Local import discovery exceeded ${limit} limit (${maximum})`)
    this.name = 'LocalImportDiscoveryLimitError'
  }
}

export async function discoverLocalImports(
  input: LocalImportDiscoveryInput,
  options: LocalImportDiscoveryOptions = {}
): Promise<LocalImportDiscoveryResult> {
  const startedAt = Date.now()
  const state: LocalImportDiscoveryState = {
    signal: options.signal,
    limits: { ...LOCAL_IMPORT_DISCOVERY_LIMITS, ...options.limits },
    directoriesVisited: 0,
    entriesVisited: 0,
    worksDiscovered: 0,
    existingWorksPruned: 0,
    newWorks: 0
  }

  try {
    return await discoverLocalImportsWithState(input, state, startedAt)
  } catch (error) {
    const metrics = buildDiscoveryMetrics(state, startedAt)
    if (isAbortError(error)) {
      logger.info('local-import.discovery.cancelled', metrics)
    } else {
      logger.warn('local-import.discovery.failed', { ...metrics, error })
    }
    throw error
  }
}

async function discoverLocalImportsWithState(
  input: LocalImportDiscoveryInput,
  state: LocalImportDiscoveryState,
  startedAt: number
): Promise<LocalImportDiscoveryResult> {
  throwIfAborted(state.signal)
  const { scanPath } = localImportDiscoveryInputSchema.parse(input)
  const importRoot = path.resolve(scanPath, LOCAL_IMPORT_DIRECTORY)
  const db = prisma as any
  // 先并行拉取现有 artwork 路径和人工映射：
  // existingPaths 用于把“已导入目录”直接标记为 existing，避免扫描后重复写入。
  const [existingRows, mappingRows] = await Promise.all([
    db.artwork.findMany({
      where: {
        createdVia: 'LOCAL_DIRECTORY',
        storagePath: { not: null }
      },
      select: { storagePath: true }
    }),
    db.localImportArtistMapping.findMany({
      include: { artist: { select: { id: true, name: true } } }
    })
  ])
  throwIfAborted(state.signal)
  const existingPaths = new Set<string>()
  for (const row of existingRows as Array<{ storagePath: string | null }>) {
    if (!row.storagePath) continue
    try {
      existingPaths.add(canonicalizeLocalImportStoragePath(row.storagePath))
    } catch {
      // 忽略旧版无效路径：它们无法匹配标准化的候选路径。
    }
  }
  const mappings = new Map(
    (mappingRows as Array<{ artistDirectory: string; artistId: number; artist: { name: string } }>).map((row) => [
      row.artistDirectory,
      { artistId: row.artistId, artistName: row.artist.name }
    ])
  )

  const artistEntries = await readDirectories(importRoot, state)
  const artists: LocalImportArtistItem[] = []
  for (const artistEntry of artistEntries) {
    throwIfAborted(state.signal)
    const artistDirectory = artistEntry.name
    const artistPath = path.join(importRoot, artistDirectory)
    const works = await discoverArtistWorks({
      artistDirectory,
      artistPath,
      existingPaths,
      state
    })

    artists.push({
      artistDirectory,
      mapping: mappings.get(artistDirectory) ?? null,
      works
    })
  }

  const allWorks = artists.flatMap((artist) => artist.works)
  const result: LocalImportDiscoveryResult = {
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
  logger.info('local-import.discovery.completed', {
    ...buildDiscoveryMetrics(state, startedAt),
    artists: result.counts.artists,
    existingWorks: result.counts.existing,
    invalidWorks: result.counts.invalid,
    mediaCount: result.counts.media,
    responseBytes: Buffer.byteLength(JSON.stringify(result), 'utf8')
  })
  return result
}

async function discoverArtistWorks(input: {
  artistDirectory: string
  artistPath: string
  existingPaths: Set<string>
  state: LocalImportDiscoveryState
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
  state: LocalImportDiscoveryState
}) {
  const { artistDirectory, artistPath, relativeDirectorySegments, existingPaths, works, state } = input
  throwIfAborted(state.signal)
  if (relativeDirectorySegments.length > state.limits.maxDepth) {
    throw new LocalImportDiscoveryLimitError('maxDepth', state.limits.maxDepth)
  }
  const currentPath = path.join(artistPath, ...relativeDirectorySegments)
  let currentWork: {
    workDirectory: string
    relativeDirectory: string
    storagePath: string
  } | null = null

  // 深度优先遍历子目录：只要能推导出相对路径就形成一条作品候选；
  // 该路径一旦被 existingPaths 命中即判定为 existing 并不继续深入媒体扫描，以减少重复 IO。
  if (relativeDirectorySegments.length > 0) {
    const relativeDirectory = relativeDirectorySegments.join('/')
    const workDirectory = relativeDirectorySegments[relativeDirectorySegments.length - 1]!
    const storagePath = canonicalizeLocalImportStoragePath(
      path.posix.join(LOCAL_IMPORT_DIRECTORY, artistDirectory, relativeDirectory)
    )

    currentWork = { workDirectory, relativeDirectory, storagePath }
    if (existingPaths.has(storagePath)) {
      appendWork(works, state, {
        workDirectory,
        relativeDirectory,
        title: workDirectory,
        storagePath,
        status: 'existing',
        mediaCount: 0
      })
      state.existingWorksPruned += 1
      return
    }
  }

  const entries = await readVisibleEntries(currentPath, state)
  const childDirectories = entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name))

  if (currentWork) {
    const mediaCount = entries.reduce(
      (count, entry) =>
        count + Number(entry.isFile() && supportedMediaExtensions.has(path.extname(entry.name).toLowerCase())),
      0
    )

    if (mediaCount > 0) {
      appendWork(works, state, {
        workDirectory: currentWork.workDirectory,
        relativeDirectory: currentWork.relativeDirectory,
        title: currentWork.workDirectory,
        storagePath: currentWork.storagePath,
        status: 'new',
        mediaCount
      })
      state.newWorks += 1
    }
  }

  for (const childDirectory of childDirectories) {
    throwIfAborted(state.signal)
    await visitWorkDirectory({
      artistDirectory,
      artistPath,
      relativeDirectorySegments: [...relativeDirectorySegments, childDirectory.name],
      existingPaths,
      works,
      state
    })
  }
}

async function readDirectories(directory: string, state: LocalImportDiscoveryState) {
  try {
    const entries = await readVisibleEntries(directory, state)
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error: any) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

async function readVisibleEntries(directory: string, state: LocalImportDiscoveryState) {
  throwIfAborted(state.signal)
  state.directoriesVisited += 1
  const entries = await fs.readdir(directory, { withFileTypes: true })
  throwIfAborted(state.signal)
  state.entriesVisited += entries.length
  if (state.entriesVisited > state.limits.maxEntries) {
    throw new LocalImportDiscoveryLimitError('maxEntries', state.limits.maxEntries)
  }
  return entries.filter((entry) => !entry.name.startsWith('.'))
}

function appendWork(works: LocalImportWorkItem[], state: LocalImportDiscoveryState, work: LocalImportWorkItem) {
  if (state.worksDiscovered >= state.limits.maxWorks) {
    throw new LocalImportDiscoveryLimitError('maxWorks', state.limits.maxWorks)
  }
  works.push(work)
  state.worksDiscovered += 1
}

function buildDiscoveryMetrics(state: LocalImportDiscoveryState, startedAt: number) {
  return {
    durationMs: Date.now() - startedAt,
    directoriesVisited: state.directoriesVisited,
    entriesVisited: state.entriesVisited,
    existingWorksPruned: state.existingWorksPruned,
    newWorks: state.newWorks,
    worksDiscovered: state.worksDiscovered
  }
}

function throwIfAborted(signal?: AbortSignal) {
  signal?.throwIfAborted()
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}
