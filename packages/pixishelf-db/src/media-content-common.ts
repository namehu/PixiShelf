import { randomUUID } from 'node:crypto'
import { Prisma, type MediaContentDirectoryState } from '@prisma/client'
import {
  MediaContentConflictError,
  type MediaContentDirectoryKey,
  type MediaContentDirectorySnapshot,
  type MediaContentTransaction
} from './media-content-types'

export const ACTIVE_CONTENT_WRITES = ['ACTIVE', 'READY', 'RECOVERY_REQUIRED'] as const
export const MAX_CONTENT_BIGINT = 9_223_372_036_854_775_807n
export function assertContentInteger(value: bigint, name: string, positive = false) {
  if (typeof value !== 'bigint' || value < (positive ? 1n : 0n) || value > MAX_CONTENT_BIGINT)
    throw new RangeError(`Invalid ${name}`)
}
export function assertContentText(value: string, name: string) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0'))
    throw new TypeError(`Invalid ${name}`)
}
export function assertContentHash(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new TypeError('Invalid SHA-256')
}
export function assertContentPath(value: string, allowRoot = false) {
  if (allowRoot && value === '') return
  assertContentText(value, 'canonical path')
  if (
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    value.split('/').some((s) => !s || s === '.' || s === '..') ||
    value.split('/').length > 64
  )
    throw new TypeError('Invalid canonical path')
}
export function assertContentLimit(value: number, max: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new RangeError(`Page size must be between 1 and ${max}`)
}
export function contentIds(ids: readonly number[], max = 100) {
  if (ids.length > max || new Set(ids).size !== ids.length || ids.some((id) => !Number.isSafeInteger(id) || id < 1))
    throw new RangeError('Invalid or repeated content IDs')
  return [...ids].sort((a, b) => a - b)
}
export function directorySnapshot(row: MediaContentDirectoryState): MediaContentDirectorySnapshot {
  if (row.logicalRoot !== 'source-media:v1' && row.logicalRoot !== 'archive-media:v1')
    throw new TypeError('Invalid logical root')
  return {
    directoryId: row.id,
    logicalRoot: row.logicalRoot,
    rootIdentity: row.rootIdentity,
    relativeDirectory: row.relativeDirectory,
    generation: row.generation
  }
}
export function insideDirectory(directory: string, path: string) {
  return directory === '' || path === directory || path.startsWith(`${directory}/`)
}
export function directoryAncestors(path: string) {
  return [
    '',
    ...path
      .split('/')
      .filter(Boolean)
      .map((_, i, parts) => parts.slice(0, i + 1).join('/'))
  ]
}

/** Root rows serialize overlap checks across distinct descendant directory IDs. No lock spans file I/O. */
export async function lockContentDirectories(tx: MediaContentTransaction, keys: readonly MediaContentDirectoryKey[]) {
  if (keys.length > 100) throw new RangeError('At most 100 directories per operation')
  const roots = new Map<string, string>()
  for (const key of keys) {
    if (key.logicalRoot !== 'source-media:v1' && key.logicalRoot !== 'archive-media:v1')
      throw new TypeError('Invalid logical root')
    assertContentPath(key.relativeDirectory, true)
    assertContentText(key.rootIdentity, 'root identity')
    if (roots.has(key.logicalRoot) && roots.get(key.logicalRoot) !== key.rootIdentity)
      throw new MediaContentConflictError('ROOT_CHANGED')
    roots.set(key.logicalRoot, key.rootIdentity)
  }
  if (keys.length === 0) return new Map<string, MediaContentDirectoryState>()
  const rootNames = [...roots.keys()].sort()
  await tx.mediaContentDirectoryState.createMany({
    data: rootNames.map((logicalRoot) => ({
      id: randomUUID(),
      logicalRoot,
      relativeDirectory: '',
      rootIdentity: roots.get(logicalRoot)!
    })),
    skipDuplicates: true
  })
  const rootRows = await tx.$queryRaw<MediaContentDirectoryState[]>(
    Prisma.sql`SELECT * FROM "MediaContentDirectoryState" WHERE "logicalRoot" IN (${Prisma.join(rootNames)}) AND "relativeDirectory" = '' ORDER BY "logicalRoot" COLLATE "C" FOR UPDATE`
  )
  if (rootRows.some((row) => row.rootIdentity !== roots.get(row.logicalRoot)))
    throw new MediaContentConflictError('ROOT_CHANGED')
  const unique = new Map<string, MediaContentDirectoryKey>()
  for (const key of keys)
    for (const relativeDirectory of directoryAncestors(key.relativeDirectory))
      unique.set(`${key.logicalRoot}\0${relativeDirectory}`, {
        logicalRoot: key.logicalRoot,
        rootIdentity: key.rootIdentity,
        relativeDirectory
      })
  const allKeys = [...unique.values()].sort((a, b) =>
    a.logicalRoot < b.logicalRoot
      ? -1
      : a.logicalRoot > b.logicalRoot
        ? 1
        : a.relativeDirectory < b.relativeDirectory
          ? -1
          : a.relativeDirectory > b.relativeDirectory
            ? 1
            : 0
  )
  await tx.mediaContentDirectoryState.createMany({
    data: allKeys.map((key) => ({ id: randomUUID(), ...key })),
    skipDuplicates: true
  })
  const rows = await tx.$queryRaw<MediaContentDirectoryState[]>(
    Prisma.sql`SELECT * FROM "MediaContentDirectoryState" WHERE ("logicalRoot", "relativeDirectory") IN (VALUES ${Prisma.join(allKeys.map((k) => Prisma.sql`(${k.logicalRoot}, ${k.relativeDirectory})`))}) ORDER BY "logicalRoot" COLLATE "C", "relativeDirectory" COLLATE "C" FOR UPDATE`
  )
  if (rows.some((row) => row.rootIdentity !== roots.get(row.logicalRoot)))
    throw new MediaContentConflictError('ROOT_CHANGED')
  return new Map(rows.map((row) => [`${row.logicalRoot}\0${row.relativeDirectory}`, row]))
}

export async function lockContentArtworks(tx: MediaContentTransaction, artworkIds: readonly number[]) {
  const ids = [...new Set(artworkIds)].sort((a, b) => a - b)
  if (ids.length === 0) return []
  return tx.$queryRaw<Array<{ id: number }>>(
    Prisma.sql`SELECT id FROM "Artwork" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`
  )
}

export async function lockContentImages(tx: MediaContentTransaction, imageIds: readonly number[]) {
  if (imageIds.length === 0) return []
  return tx.$queryRaw<Array<{ id: number; artworkId: number | null; path: string }>>(
    Prisma.sql`SELECT id, "artworkId", path FROM "Image" WHERE id IN (${Prisma.join([...imageIds].sort((a, b) => a - b))}) ORDER BY id FOR KEY SHARE NOWAIT`
  )
}

export async function advanceArtworkContent(tx: MediaContentTransaction, ids: readonly number[]) {
  const unique = [...new Set(ids)].sort((a, b) => a - b)
  if (!unique.length) return
  await tx.$executeRaw(
    Prisma.sql`INSERT INTO "ArtworkContentSource" ("artworkId", revision, "mediaEpoch", "updatedAt") SELECT id, 1, 0, CURRENT_TIMESTAMP FROM "Artwork" WHERE id IN (${Prisma.join(unique)}) ORDER BY id ON CONFLICT ("artworkId") DO UPDATE SET revision = "ArtworkContentSource".revision + 1, "updatedAt" = CURRENT_TIMESTAMP`
  )
  await tx.artworkContentFingerprint.deleteMany({ where: { artworkId: { in: unique } } })
}

export async function advanceDirectoryContent(
  tx: MediaContentTransaction,
  directoryIds: readonly string[],
  recursiveDirectoryIds: readonly string[] = []
) {
  if (!directoryIds.length) return
  const affectedDirectories = Prisma.sql`SELECT d.id FROM "MediaContentDirectoryState" d WHERE EXISTS (SELECT 1 FROM "MediaContentDirectoryState" p WHERE p.id IN (${Prisma.join(directoryIds)}) AND p."logicalRoot" = d."logicalRoot" AND (d."relativeDirectory" = '' OR d."relativeDirectory" = p."relativeDirectory" OR left(p."relativeDirectory", length(d."relativeDirectory") + 1) = d."relativeDirectory" || '/')) ${recursiveDirectoryIds.length ? Prisma.sql`OR EXISTS (SELECT 1 FROM "MediaContentDirectoryState" p WHERE p.id IN (${Prisma.join(recursiveDirectoryIds)}) AND p."logicalRoot" = d."logicalRoot" AND (p."relativeDirectory" = '' OR d."relativeDirectory" = p."relativeDirectory" OR left(d."relativeDirectory", length(p."relativeDirectory") + 1) = p."relativeDirectory" || '/'))` : Prisma.empty}`
  const affectedArtworks = Prisma.sql`SELECT DISTINCT i."artworkId" FROM "Image" i JOIN "MediaContentSource" s ON s."imageId" = i.id WHERE s."directoryStateId" IN (${affectedDirectories}) AND i."artworkId" IS NOT NULL`
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Artwork" WHERE id IN (${affectedArtworks}) ORDER BY id FOR UPDATE`)
  await tx.$executeRaw(
    Prisma.sql`UPDATE "MediaContentDirectoryState" SET generation = generation + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE id IN (${affectedDirectories})`
  )
  await tx.$executeRaw(
    Prisma.sql`INSERT INTO "ArtworkContentSource" ("artworkId",revision,"mediaEpoch","updatedAt") SELECT id,1,0,CURRENT_TIMESTAMP FROM "Artwork" WHERE id IN (${affectedArtworks}) ORDER BY id ON CONFLICT ("artworkId") DO UPDATE SET revision = "ArtworkContentSource".revision + 1, "updatedAt" = CURRENT_TIMESTAMP`
  )
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ArtworkContentFingerprint" WHERE "artworkId" IN (${affectedArtworks})`)
}
