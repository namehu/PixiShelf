import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rescanArtwork, rescanLocalArtwork } from '../index'

type ArtistRecord = {
  id: number
  name: string
  username: string
  userId: string | null
  bio: string | null
}

type ArtworkRecord = {
  id: number
  title: string
  description: string | null
  artistId: number
  imageCount: number
  descriptionLength: number
  externalId: string | null
  metaSource: string | null
  sourceUrl: string | null
  originalUrl: string | null
  thumbnailUrl: string | null
  xRestrict: string | null
  isAiGenerated: boolean
  size: string | null
  bookmarkCount: number | null
  sourceDate: Date | null
  directoryCreatedAt: Date | null
  metadataFormat: 'txt' | 'json' | null
  pixivAiType: number | null
  pixivType: number | null
  sanityLevel: number | null
}

type TagRecord = {
  id: number
  name: string
  isSystem?: boolean
  systemKey?: string
}

type ImageRecord = {
  id: number
  artworkId: number
  path: string
  size: number
  sortOrder: number
  width?: number
  height?: number
  chaptersPath: string | null
  chaptersCount: number
  chaptersDuration: number | null
  chaptersUpdatedAt: Date | null
  chaptersHash: string | null
}

type ArtworkTagRecord = {
  artworkId: number
  tagId: number
}

type RawMetadataRecord = {
  artworkId: number
  rawMetadataJson: unknown
}

type ArtistCreateInput = Omit<ArtistRecord, 'id'>
type ArtworkCreateInput = Omit<ArtworkRecord, 'id'>
type TagCreateInput = Omit<TagRecord, 'id'>
type ImageCreateInput = Omit<ImageRecord, 'id'>
type ArtworkTagCreateInput = ArtworkTagRecord
type RawMetadataCreateInput = RawMetadataRecord
type PrismaFindArgs = { where?: Record<string, unknown>; select?: Record<string, boolean> }
type PrismaCreateArgs<TData> = { data: TData; select?: Record<string, boolean> }
type PrismaCreateManyArgs<TData> = { data: TData[]; skipDuplicates?: boolean }
type PrismaUpdateArgs<TData> = {
  where: Record<string, unknown>
  data: Partial<TData>
  select?: Record<string, boolean>
}
type PrismaDeleteManyArgs = { where?: Record<string, unknown> }
type PrismaUpsertArgs<TData> = { where: Record<string, unknown>; create: TData; update: Partial<TData> }
type TagFindCondition = { systemKey?: string; name?: string }
type PrismaTransactionCallback = (tx: unknown) => Promise<unknown>

const { database, prismaStub } = vi.hoisted(() => {
  const database = {
    artists: [] as ArtistRecord[],
    artworks: [] as ArtworkRecord[],
    tags: [] as TagRecord[],
    images: [] as ImageRecord[],
    artworkTags: [] as ArtworkTagRecord[],
    rawMetadata: [] as RawMetadataRecord[],
    nextArtistId: 1,
    nextArtworkId: 1,
    nextTagId: 1,
    nextImageId: 1
  }

  function valuesIn<T>(args: { where?: Record<string, unknown> }, field: string): T[] | undefined {
    const condition = args.where?.[field]
    if (!isRecord(condition) || !Array.isArray(condition.in)) return undefined
    return condition.in as T[]
  }

  function selectFields<T extends object>(record: T, select?: Record<string, boolean>): Partial<T> {
    if (!select) return record

    const recordEntries = record as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(select)
        .filter(([, enabled]) => enabled)
        .map(([key]) => [key, recordEntries[key]])
    ) as Partial<T>
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }

  const prismaStub = {
    artist: {
      findMany: vi.fn(async (args: PrismaFindArgs = {}) => {
        const userIds = valuesIn<string>(args, 'userId')
        return database.artists.filter((artist) => !userIds || (artist.userId && userIds.includes(artist.userId)))
      }),
      createMany: vi.fn(async (args: PrismaCreateManyArgs<ArtistCreateInput>) => {
        let count = 0
        for (const artist of args.data) {
          if (args.skipDuplicates && database.artists.some((item) => item.userId === artist.userId)) continue
          database.artists.push({
            id: database.nextArtistId++,
            name: artist.name,
            username: artist.username,
            userId: artist.userId,
            bio: artist.bio
          })
          count++
        }
        return { count }
      })
    },
    artwork: {
      findMany: vi.fn(async (args: PrismaFindArgs = {}) => {
        const externalIds = valuesIn<string>(args, 'externalId')
        return database.artworks
          .filter((artwork) => !externalIds || (artwork.externalId && externalIds.includes(artwork.externalId)))
          .map((artwork) => selectFields(artwork, args.select))
      }),
      findUnique: vi.fn(async (args: PrismaFindArgs) => {
        const where = args.where ?? {}
        if (where.externalId !== undefined) {
          return database.artworks.find((artwork) => artwork.externalId === where.externalId) || null
        }
        if (where.id !== undefined) {
          return database.artworks.find((artwork) => artwork.id === where.id) || null
        }
        return null
      }),
      createMany: vi.fn(async (args: PrismaCreateManyArgs<ArtworkCreateInput>) => {
        let count = 0
        for (const artwork of args.data) {
          if (
            args.skipDuplicates &&
            artwork.externalId &&
            database.artworks.some((item) => item.externalId === artwork.externalId)
          ) {
            continue
          }
          database.artworks.push({
            id: database.nextArtworkId++,
            ...artwork
          })
          count++
        }
        return { count }
      }),
      update: vi.fn(async (args: PrismaUpdateArgs<ArtworkRecord>) => {
        const artwork = database.artworks.find((item) => item.id === args.where.id)
        if (!artwork) throw new Error(`Artwork not found: ${args.where.id}`)
        Object.assign(artwork, args.data)
        return artwork
      })
    },
    tag: {
      findMany: vi.fn(async (args: PrismaFindArgs = {}) => {
        const names = valuesIn<string>(args, 'name')
        const ids = valuesIn<number>(args, 'id')
        return database.tags
          .filter((tag) => (!names || names.includes(tag.name)) && (!ids || ids.includes(tag.id)))
          .map((tag) => selectFields(tag, args.select))
      }),
      findFirst: vi.fn(async (args: PrismaFindArgs = {}) => {
        const or = Array.isArray(args.where?.OR) ? (args.where.OR as TagFindCondition[]) : []
        const found = database.tags.find((tag) =>
          or.some(
            (condition) =>
              (condition.systemKey !== undefined && condition.systemKey === tag.systemKey) ||
              (condition.name !== undefined && condition.name === tag.name)
          )
        )
        return found ? selectFields(found, args.select) : null
      }),
      create: vi.fn(async (args: PrismaCreateArgs<TagCreateInput>) => {
        const tag = {
          id: database.nextTagId++,
          name: args.data.name,
          isSystem: args.data.isSystem,
          systemKey: args.data.systemKey
        }
        database.tags.push(tag)
        return selectFields(tag, args.select)
      }),
      update: vi.fn(async (args: PrismaUpdateArgs<TagRecord>) => {
        const tag = database.tags.find((item) => item.id === args.where.id)
        if (!tag) throw new Error(`Tag not found: ${args.where.id}`)
        Object.assign(tag, args.data)
        return selectFields(tag, args.select)
      }),
      createMany: vi.fn(async (args: PrismaCreateManyArgs<TagCreateInput>) => {
        let count = 0
        for (const tag of args.data) {
          if (args.skipDuplicates && database.tags.some((item) => item.name === tag.name)) continue
          database.tags.push({
            id: database.nextTagId++,
            name: tag.name,
            isSystem: tag.isSystem,
            systemKey: tag.systemKey
          })
          count++
        }
        return { count }
      })
    },
    image: {
      findMany: vi.fn(async (args: PrismaFindArgs = {}) => {
        const artworkIds = valuesIn<number>(args, 'artworkId')
        const directArtworkId = args.where?.artworkId
        return database.images
          .filter((image) => {
            if (Array.isArray(artworkIds)) return artworkIds.includes(image.artworkId)
            if (typeof directArtworkId === 'number') return image.artworkId === directArtworkId
            return true
          })
          .map((image) => selectFields(image, args.select))
      }),
      deleteMany: vi.fn(async (args: PrismaDeleteManyArgs = {}) => {
        const artworkId = args.where?.artworkId
        const before = database.images.length
        database.images = database.images.filter((image) => image.artworkId !== artworkId)
        return { count: before - database.images.length }
      }),
      createMany: vi.fn(async (args: PrismaCreateManyArgs<ImageCreateInput>) => {
        let count = 0
        for (const image of args.data) {
          if (
            args.skipDuplicates &&
            database.images.some((item) => item.artworkId === image.artworkId && item.path === image.path)
          ) {
            continue
          }
          const {
            chaptersPath = null,
            chaptersCount = 0,
            chaptersDuration = null,
            chaptersUpdatedAt = null,
            chaptersHash = null,
            ...imageFields
          } = image
          database.images.push({
            id: database.nextImageId++,
            ...imageFields,
            chaptersPath,
            chaptersCount,
            chaptersDuration,
            chaptersUpdatedAt,
            chaptersHash
          })
          count++
        }
        return { count }
      })
    },
    artworkTag: {
      createMany: vi.fn(async (args: PrismaCreateManyArgs<ArtworkTagCreateInput>) => {
        let count = 0
        for (const relation of args.data) {
          if (
            args.skipDuplicates &&
            database.artworkTags.some((item) => item.artworkId === relation.artworkId && item.tagId === relation.tagId)
          ) {
            continue
          }
          database.artworkTags.push(relation)
          count++
        }
        return { count }
      }),
      deleteMany: vi.fn(async (args: PrismaDeleteManyArgs = {}) => {
        const tagId = args.where?.tagId
        const artworkIds = valuesIn<number>(args, 'artworkId')
        const before = database.artworkTags.length
        database.artworkTags = database.artworkTags.filter((relation) => {
          if (tagId !== undefined && relation.tagId !== tagId) return true
          if (artworkIds && !artworkIds.includes(relation.artworkId)) return true
          return false
        })
        return { count: before - database.artworkTags.length }
      })
    },
    artworkRawMetadata: {
      createMany: vi.fn(async (args: PrismaCreateManyArgs<RawMetadataCreateInput>) => {
        let count = 0
        for (const rawMetadata of args.data) {
          if (args.skipDuplicates && database.rawMetadata.some((item) => item.artworkId === rawMetadata.artworkId)) {
            continue
          }
          database.rawMetadata.push(rawMetadata)
          count++
        }
        return { count }
      }),
      upsert: vi.fn(async (args: PrismaUpsertArgs<RawMetadataCreateInput>) => {
        const existing = database.rawMetadata.find((item) => item.artworkId === args.where.artworkId)
        if (existing) {
          Object.assign(existing, args.update)
          return existing
        }
        database.rawMetadata.push(args.create)
        return args.create
      }),
      deleteMany: vi.fn(async (args: PrismaDeleteManyArgs = {}) => {
        const artworkId = args.where?.artworkId
        const before = database.rawMetadata.length
        database.rawMetadata = database.rawMetadata.filter((item) => item.artworkId !== artworkId)
        return { count: before - database.rawMetadata.length }
      })
    },
    $transaction: vi.fn(async (callback: PrismaTransactionCallback) => callback(prismaStub)),
    $executeRawUnsafe: vi.fn()
  }

  return { database, prismaStub }
})

const fixtureRoots: string[] = []

function resetDatabase() {
  database.artists = []
  database.artworks = []
  database.tags = []
  database.images = []
  database.artworkTags = []
  database.rawMetadata = []
  database.nextArtistId = 1
  database.nextArtworkId = 1
  database.nextTagId = 1
  database.nextImageId = 1
}

function seedArtist(input: Partial<ArtistRecord> = {}) {
  const artist: ArtistRecord = {
    id: database.nextArtistId++,
    name: 'Seed Artist',
    username: 'Seed Artist',
    userId: '20001',
    bio: null,
    ...input
  }
  database.artists.push(artist)
  return artist
}

function seedArtwork(input: Partial<ArtworkRecord> = {}) {
  const artwork: ArtworkRecord = {
    id: database.nextArtworkId++,
    title: 'Old title',
    description: 'Old description',
    artistId: 1,
    imageCount: 1,
    descriptionLength: 15,
    externalId: '2001',
    metaSource: null,
    sourceUrl: null,
    originalUrl: null,
    thumbnailUrl: null,
    xRestrict: null,
    isAiGenerated: false,
    size: null,
    bookmarkCount: null,
    sourceDate: null,
    directoryCreatedAt: null,
    metadataFormat: 'txt',
    pixivAiType: null,
    pixivType: null,
    sanityLevel: null,
    ...input
  }
  database.artworks.push(artwork)
  return artwork
}

function seedTag(input: Partial<TagRecord>) {
  const tag: TagRecord = {
    id: database.nextTagId++,
    name: 'manual-tag',
    ...input
  }
  database.tags.push(tag)
  return tag
}

function seedImage(input: Partial<ImageRecord>) {
  const image: ImageRecord = {
    id: database.nextImageId++,
    artworkId: 1,
    path: '/old/old.jpg',
    size: 1,
    sortOrder: 0,
    chaptersPath: null,
    chaptersCount: 0,
    chaptersDuration: null,
    chaptersUpdatedAt: null,
    chaptersHash: null,
    ...input
  }
  database.images.push(image)
  return image
}

vi.mock('@/lib/prisma', () => ({
  prisma: prismaStub
}))

vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    metadata: vi.fn(async () => ({ width: 320, height: 240 }))
  }))
}))

async function createFixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-rescan-fixture-'))
  fixtureRoots.push(root)
  return root
}

describe('rescan fixture integration', () => {
  beforeEach(() => {
    resetDatabase()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('rescans Pixiv metadata artwork, replaces media and raw metadata, and keeps existing tag relations', async () => {
    const scanPath = await createFixtureRoot()
    const pixivDirectory = path.join(scanPath, 'pixiv')
    await mkdir(pixivDirectory, { recursive: true })
    const originalArtist = seedArtist({ userId: '20001', name: 'Original Artist', username: 'Original Artist' })
    const artwork = seedArtwork({
      artistId: originalArtist.id,
      externalId: '2001',
      title: 'Old Pixiv title'
    })
    const manualTag = seedTag({ name: 'manual-tag' })
    database.artworkTags.push({ artworkId: artwork.id, tagId: manualTag.id })
    database.rawMetadata.push({ artworkId: artwork.id, rawMetadataJson: { title: 'old raw title' } })
    seedImage({ artworkId: artwork.id, path: '/pixiv/old.jpg', size: 3 })

    await writeFile(
      path.join(pixivDirectory, '2001-meta.json'),
      JSON.stringify({
        id: 2001,
        user: 'Updated Pixiv Artist',
        userId: '20002',
        title: 'Updated Pixiv title',
        description: 'Updated Pixiv description',
        tags: ['new-tag-from-metadata'],
        original: 'https://i.pximg.net/img-original/img/2001.png',
        thumb: 'https://i.pximg.net/c/2001.jpg',
        aiType: 2,
        type: 0,
        sl: 4,
        fullWidth: 1200,
        fullHeight: 900,
        bmk: 99,
        uploadDate: '2024-03-04T05:06:07+09:00'
      })
    )
    await writeFile(path.join(pixivDirectory, '2001_p0.png'), 'updated-image-0')
    await writeFile(path.join(pixivDirectory, '2001_p1.jpg'), 'updated-image-1')

    const progressEvents: Array<{ phase: string; percentage?: number; message: string }> = []
    const result = await rescanArtwork(
      {
        scanPath,
        onProgress: (event) => progressEvents.push(event)
      },
      '2001',
      '/pixiv'
    )

    expect(result.errors).toEqual([])
    expect(result.totalArtworks).toBe(1)
    expect(result.newArtists).toBe(1)
    expect(result.newArtworks).toBe(1)
    expect(result.newImages).toBe(2)
    expect(artwork).toMatchObject({
      title: 'Updated Pixiv title',
      description: 'Updated Pixiv description',
      artistId: 2,
      metadataFormat: 'json',
      pixivAiType: 2,
      pixivType: 0,
      sanityLevel: 4,
      bookmarkCount: 99
    })
    expect(database.images.map((image) => image.path).sort()).toEqual(['/pixiv/2001_p0.png', '/pixiv/2001_p1.jpg'])
    expect(database.rawMetadata).toHaveLength(1)
    expect(database.rawMetadata[0]?.rawMetadataJson).toMatchObject({
      id: 2001,
      title: 'Updated Pixiv title'
    })
    expect(database.artworkTags).toEqual(expect.arrayContaining([{ artworkId: artwork.id, tagId: manualTag.id }]))
    expect(database.tags.map((tag) => tag.name)).not.toContain('new-tag-from-metadata')
    expect(progressEvents.at(-1)).toMatchObject({
      phase: 'complete',
      percentage: 100,
      message: '重新扫描完成'
    })
  })

  it('rescans local artwork media without overwriting manually maintained artwork fields and tags', async () => {
    const scanPath = await createFixtureRoot()
    const localDirectory = path.join(scanPath, 'local')
    await mkdir(localDirectory, { recursive: true })
    const artist = seedArtist({ userId: null, name: 'Manual Artist', username: 'Manual Artist' })
    const artwork = seedArtwork({
      id: 42,
      artistId: artist.id,
      externalId: null,
      title: 'Manual local title',
      description: 'Manual local description',
      metadataFormat: null
    })
    const manualTag = seedTag({ name: 'manual-local-tag' })
    database.artworkTags.push({ artworkId: artwork.id, tagId: manualTag.id })
    seedImage({ artworkId: artwork.id, path: '/local/old.png', size: 3 })
    await writeFile(path.join(localDirectory, 'new-b.png'), 'new-b')
    await writeFile(path.join(localDirectory, 'new-a.jpg'), 'new-a')

    const progressEvents: Array<{ phase: string; percentage?: number; message: string }> = []
    const result = await rescanLocalArtwork(
      {
        scanPath,
        onProgress: (event) => progressEvents.push(event)
      },
      artwork.id,
      '/local'
    )

    expect(result.errors).toEqual([])
    expect(result.totalArtworks).toBe(1)
    expect(result.newArtworks).toBe(1)
    expect(result.newImages).toBe(2)
    expect(artwork).toMatchObject({
      title: 'Manual local title',
      description: 'Manual local description',
      artistId: artist.id,
      externalId: null,
      metadataFormat: null
    })
    expect(database.images.map((image) => image.path)).toEqual(['/local/new-a.jpg', '/local/new-b.png'])
    expect(database.images.map((image) => image.width)).toEqual([320, 320])
    expect(database.artworkTags).toEqual(expect.arrayContaining([{ artworkId: artwork.id, tagId: manualTag.id }]))
    expect(progressEvents.at(-1)).toMatchObject({
      phase: 'complete',
      percentage: 100,
      message: '本地作品重新扫描完成'
    })
  })
})
