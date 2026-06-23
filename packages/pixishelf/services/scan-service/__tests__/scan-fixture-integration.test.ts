import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scan } from '../index'

const { loggerInfoMock } = vi.hoisted(() => ({
  loggerInfoMock: vi.fn()
}))

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
  externalId: string
  metaSource: string
  sourceUrl: string | null
  originalUrl: string | null
  thumbnailUrl: string | null
  xRestrict: string | null
  isAiGenerated: boolean
  size: string | null
  bookmarkCount: number | null
  sourceDate: Date | null
  directoryCreatedAt: Date
  metadataFormat: 'txt' | 'json'
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

  function valuesIn<T>(args: { where?: Record<string, any> }, field: string): T[] | undefined {
    return args.where?.[field]?.in
  }

  function selectFields<T extends Record<string, any>>(record: T, select?: Record<string, boolean>): Partial<T> {
    if (!select) return record

    return Object.fromEntries(
      Object.entries(select)
        .filter(([, enabled]) => enabled)
        .map(([key]) => [key, record[key]])
    ) as Partial<T>
  }

  const prismaStub = {
    artist: {
      findMany: vi.fn(async (args: any = {}) => {
        const userIds = valuesIn<string>(args, 'userId')
        return database.artists.filter((artist) => !userIds || (artist.userId && userIds.includes(artist.userId)))
      }),
      createMany: vi.fn(async (args: any) => {
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
      findMany: vi.fn(async (args: any = {}) => {
        const externalIds = valuesIn<string>(args, 'externalId')
        return database.artworks
          .filter((artwork) => !externalIds || externalIds.includes(artwork.externalId))
          .map((artwork) => selectFields(artwork, args.select))
      }),
      createMany: vi.fn(async (args: any) => {
        let count = 0
        for (const artwork of args.data) {
          if (args.skipDuplicates && database.artworks.some((item) => item.externalId === artwork.externalId)) continue
          database.artworks.push({
            id: database.nextArtworkId++,
            ...artwork
          })
          count++
        }
        return { count }
      })
    },
    tag: {
      findMany: vi.fn(async (args: any = {}) => {
        const names = valuesIn<string>(args, 'name')
        return database.tags
          .filter((tag) => !names || names.includes(tag.name))
          .map((tag) => selectFields(tag, args.select))
      }),
      findFirst: vi.fn(async (args: any = {}) => {
        const or = args.where?.OR || []
        const found = database.tags.find((tag) =>
          or.some(
            (condition: any) =>
              (condition.systemKey !== undefined && condition.systemKey === tag.systemKey) ||
              (condition.name !== undefined && condition.name === tag.name)
          )
        )
        return found ? selectFields(found, args.select) : null
      }),
      create: vi.fn(async (args: any) => {
        const tag = {
          id: database.nextTagId++,
          name: args.data.name,
          isSystem: args.data.isSystem,
          systemKey: args.data.systemKey
        }
        database.tags.push(tag)
        return selectFields(tag, args.select)
      }),
      update: vi.fn(async (args: any) => {
        const tag = database.tags.find((item) => item.id === args.where.id)
        if (!tag) throw new Error(`Tag not found: ${args.where.id}`)
        Object.assign(tag, args.data)
        return selectFields(tag, args.select)
      }),
      createMany: vi.fn(async (args: any) => {
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
      findMany: vi.fn(async (args: any = {}) => {
        const artworkIds = valuesIn<number>(args, 'artworkId')
        return database.images
          .filter((image) => !artworkIds || artworkIds.includes(image.artworkId))
          .map((image) => selectFields(image, args.select))
      }),
      createMany: vi.fn(async (args: any) => {
        let count = 0
        for (const image of args.data) {
          if (
            args.skipDuplicates &&
            database.images.some((item) => item.artworkId === image.artworkId && item.path === image.path)
          ) {
            continue
          }
          database.images.push({
            id: database.nextImageId++,
            ...image
          })
          count++
        }
        return { count }
      })
    },
    artworkTag: {
      createMany: vi.fn(async (args: any) => {
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
      deleteMany: vi.fn(async (args: any = {}) => {
        const tagId = args.where?.tagId
        const artworkIds = args.where?.artworkId?.in as number[] | undefined
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
      createMany: vi.fn(async (args: any) => {
        let count = 0
        for (const rawMetadata of args.data) {
          if (args.skipDuplicates && database.rawMetadata.some((item) => item.artworkId === rawMetadata.artworkId)) {
            continue
          }
          database.rawMetadata.push(rawMetadata)
          count++
        }
        return { count }
      })
    },
    $transaction: vi.fn(async (callback: (tx: any) => Promise<void>) => callback(prismaStub)),
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

vi.mock('@/lib/prisma', () => ({
  prisma: prismaStub
}))

vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: loggerInfoMock,
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@/utils/sleep', () => ({
  sleep: vi.fn(async () => undefined)
}))

async function createFixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-scan-fixture-'))
  fixtureRoots.push(root)
  return root
}

async function writeTextMetadata(directory: string, artworkId: string, values: Partial<Record<string, string>>) {
  const lines = Object.entries({
    ID: artworkId,
    User: 'Fixture Artist',
    UserID: '10001',
    Title: `Fixture ${artworkId}`,
    Tags: '#tag-one\n#tag-two',
    URL: `https://www.pixiv.net/i/${artworkId}`,
    ...values
  }).flatMap(([key, value]) => [key, value, ''])

  await writeFile(path.join(directory, `${artworkId}-meta.txt`), lines.join('\n'))
}

describe('scan fixture integration', () => {
  beforeEach(() => {
    resetDatabase()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('scans fixture metadata and media into artists, artworks, images, tags, and raw metadata', async () => {
    const scanPath = await createFixtureRoot()
    const pixivDirectory = path.join(scanPath, 'pixiv')
    const jsonDirectory = path.join(scanPath, 'json')
    await mkdir(pixivDirectory, { recursive: true })
    await mkdir(jsonDirectory, { recursive: true })
    await writeTextMetadata(pixivDirectory, '1001', {
      Title: 'First fixture artwork',
      Description: 'A text metadata artwork',
      Size: '800 x 600',
      Bookmark: '42',
      Date: '2024-01-02T03:04:05+09:00'
    })
    await writeFile(path.join(pixivDirectory, '1001_p0.jpg'), 'image-0')
    await writeFile(path.join(pixivDirectory, '1001_p1.png'), 'image-1')
    await writeFile(
      path.join(jsonDirectory, '1002-meta.json'),
      JSON.stringify({
        id: 1002,
        user: 'Json Artist',
        userId: '10002',
        title: 'JSON fixture artwork',
        description: 'A JSON metadata artwork',
        tags: ['json-tag'],
        original: 'https://i.pximg.net/img-original/img/1002.png',
        thumb: 'https://i.pximg.net/c/1002.jpg',
        aiType: 2,
        type: 0,
        sl: 4,
        fullWidth: 1200,
        fullHeight: 900,
        bmk: 7,
        uploadDate: '2024-02-03T04:05:06+09:00'
      })
    )
    await writeFile(path.join(jsonDirectory, '1002.png'), 'json-image')

    const progressEvents: Array<{ phase: string; percentage?: number; message: string }> = []
    const result = await scan({
      scanPath,
      forceUpdate: false,
      onProgress: (event) => progressEvents.push(event)
    })

    expect(result.errors).toEqual([])
    expect(result.totalArtworks).toBe(2)
    expect(result.newArtists).toBe(2)
    expect(result.newArtworks).toBe(2)
    expect(result.newImages).toBe(3)
    expect(result.newTags).toBe(3)
    expect(database.artworks.map((artwork) => artwork.externalId).sort()).toEqual(['1001', '1002'])
    expect(database.images.map((image) => image.path).sort()).toEqual([
      '/json/1002.png',
      '/pixiv/1001_p0.jpg',
      '/pixiv/1001_p1.png'
    ])
    expect(database.tags.map((tag) => tag.name)).toEqual(expect.arrayContaining(['tag-one', 'tag-two', 'json-tag']))
    expect(database.rawMetadata).toHaveLength(1)
    expect(database.rawMetadata[0]?.rawMetadataJson).toMatchObject({ id: 1002, title: 'JSON fixture artwork' })
    expect(progressEvents.at(-1)).toMatchObject({
      phase: 'complete',
      percentage: 100,
      message: '扫描完成'
    })
  })

  it('skips already imported fixture artworks during a second incremental scan', async () => {
    const scanPath = await createFixtureRoot()
    const pixivDirectory = path.join(scanPath, 'pixiv')
    await mkdir(pixivDirectory, { recursive: true })
    await writeTextMetadata(pixivDirectory, '1101', {
      Title: 'Incremental fixture artwork'
    })
    await writeFile(path.join(pixivDirectory, '1101.jpg'), 'image')

    const firstResult = await scan({ scanPath, forceUpdate: false })
    const secondResult = await scan({ scanPath, forceUpdate: false })

    expect(firstResult).toMatchObject({
      totalArtworks: 1,
      skippedArtworks: 0,
      newArtists: 1,
      newArtworks: 1,
      newImages: 1
    })
    expect(secondResult).toMatchObject({
      totalArtworks: 1,
      skippedArtworks: 1,
      newArtists: 0,
      newArtworks: 0,
      newImages: 0
    })
    expect(database.artworks).toHaveLength(1)
    expect(database.images).toHaveLength(1)
  })

  it('deduplicates metadata candidates and ignores malformed or media-less fixture entries', async () => {
    const scanPath = await createFixtureRoot()
    const validDirectory = path.join(scanPath, 'valid')
    const duplicateDirectory = path.join(scanPath, 'duplicate')
    const malformedDirectory = path.join(scanPath, 'malformed')
    const noMediaDirectory = path.join(scanPath, 'no-media')
    await mkdir(validDirectory, { recursive: true })
    await mkdir(duplicateDirectory, { recursive: true })
    await mkdir(malformedDirectory, { recursive: true })
    await mkdir(noMediaDirectory, { recursive: true })

    await writeFile(
      path.join(validDirectory, '1201-meta.json'),
      JSON.stringify({
        id: 1201,
        user: 'Preferred Artist',
        userId: '12001',
        title: 'Preferred JSON metadata',
        tags: ['preferred-tag']
      })
    )
    await writeFile(path.join(validDirectory, '1201.png'), 'valid-image')
    await writeFile(
      path.join(duplicateDirectory, '1201_p0-meta.json'),
      JSON.stringify({
        id: 1201,
        user: 'Duplicate Artist',
        userId: '12001',
        title: 'Duplicate JSON metadata',
        tags: ['duplicate-tag']
      })
    )
    await writeFile(path.join(duplicateDirectory, '1201.png'), 'duplicate-image')
    await writeFile(
      path.join(malformedDirectory, '1202-meta.txt'),
      ['ID', '1202', '', 'User', 'Malformed Artist', '', 'Title', 'Missing user id', ''].join('\n')
    )
    await writeFile(path.join(malformedDirectory, '1202.png'), 'malformed-image')
    await writeTextMetadata(noMediaDirectory, '1203', {
      Title: 'No media artwork'
    })

    const result = await scan({ scanPath, forceUpdate: false })

    expect(result.totalArtworks).toBe(3)
    expect(result.newArtworks).toBe(1)
    expect(result.newImages).toBe(1)
    expect(result.errors.some((error) => error.includes('Duplicate artworkId found: 1201'))).toBe(true)
    expect(database.artworks.map((artwork) => artwork.externalId)).toEqual(['1201'])
    expect(database.images.map((image) => image.path)).toEqual(['/duplicate/1201.png'])
  })

  it('records cancellation before processing a discovered batch and leaves the database unchanged', async () => {
    const scanPath = await createFixtureRoot()
    const pixivDirectory = path.join(scanPath, 'cancelled')
    await mkdir(pixivDirectory, { recursive: true })
    await writeTextMetadata(pixivDirectory, '1301', {
      Title: 'Cancelled artwork'
    })
    await writeFile(path.join(pixivDirectory, '1301.jpg'), 'cancelled-image')

    const checkCancelled = vi.fn(async () => true)
    const result = await scan({
      scanPath,
      forceUpdate: false,
      checkCancelled
    })

    expect(checkCancelled).toHaveBeenCalledTimes(1)
    expect(result.totalArtworks).toBe(1)
    expect(result.errors).toContain('Scan cancelled')
    expect(result.newArtists).toBe(0)
    expect(result.newArtworks).toBe(0)
    expect(result.newImages).toBe(0)
    expect(result.newTags).toBe(0)
    expect(database.artists).toHaveLength(0)
    expect(database.artworks).toHaveLength(0)
    expect(database.images).toHaveLength(0)
    expect(database.tags).toHaveLength(0)
  })

  it('records batch database failures without reporting artwork or image writes as successful', async () => {
    const scanPath = await createFixtureRoot()
    const pixivDirectory = path.join(scanPath, 'db-error')
    await mkdir(pixivDirectory, { recursive: true })
    await writeTextMetadata(pixivDirectory, '1401', {
      Title: 'Database failure artwork'
    })
    await writeFile(path.join(pixivDirectory, '1401.png'), 'db-error-image')
    prismaStub.$transaction.mockRejectedValueOnce(new Error('database unavailable'))

    const result = await scan({
      scanPath,
      forceUpdate: false
    })

    expect(result.totalArtworks).toBe(1)
    expect(result.errors).toContain('Failed to process batch 1: database unavailable')
    expect(result.newArtists).toBe(1)
    expect(result.newTags).toBe(2)
    expect(result.newArtworks).toBe(0)
    expect(result.newImages).toBe(0)
    expect(database.artworks).toHaveLength(0)
    expect(database.images).toHaveLength(0)
  })

  it('logs scan performance checkpoints for discovery, parsing, batch processing, and total time', async () => {
    const scanPath = await createFixtureRoot()
    const pixivDirectory = path.join(scanPath, 'performance')
    await mkdir(pixivDirectory, { recursive: true })
    await writeTextMetadata(pixivDirectory, '1501', {
      Title: 'Performance checkpoint artwork'
    })
    await writeFile(path.join(pixivDirectory, '1501.jpg'), 'performance-image')

    await scan({
      scanPath,
      forceUpdate: false
    })

    const performanceLogs = loggerInfoMock.mock.calls
      .filter(([message]) => message === 'Scan performance checkpoint:')
      .map(([, payload]) => payload)

    expect(performanceLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: 'metadata_discovery',
          durationMs: expect.any(Number),
          totalFiles: 1,
          filesToProcess: 1
        }),
        expect.objectContaining({
          phase: 'metadata_parse_collect',
          durationMs: expect.any(Number),
          totalFiles: 1,
          parsedArtworks: 1,
          skippedFiles: 0
        }),
        expect.objectContaining({
          phase: 'tag_processing',
          durationMs: expect.any(Number),
          batchSize: 1,
          uncachedTags: 2,
          createdTags: 2
        }),
        expect.objectContaining({
          phase: 'artist_processing',
          durationMs: expect.any(Number),
          batchSize: 1,
          uncachedArtists: 1,
          createdArtists: 1
        }),
        expect.objectContaining({
          phase: 'image_seed_precompute',
          durationMs: expect.any(Number),
          batchSize: 1,
          imageSeeds: 1
        }),
        expect.objectContaining({
          phase: 'transaction_write',
          durationMs: expect.any(Number),
          batchSize: 1,
          artworksToCreate: 1,
          imagesToCreate: 1,
          artworkTagsToCreate: 2,
          rawMetadataToCreate: 0
        }),
        expect.objectContaining({
          phase: 'batch_processing',
          durationMs: expect.any(Number),
          batchNumber: 1,
          batchSize: 1,
          totalBatches: 1
        }),
        expect.objectContaining({
          phase: 'scan_total',
          durationMs: expect.any(Number),
          totalArtworks: 1,
          newArtworks: 1,
          newImages: 1,
          errors: 0
        })
      ])
    )
  })
})
