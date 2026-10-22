// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Never fall back to DATABASE_URL or an application env file. Every run creates its own database.
const isolatedUrl = process.env.RATING_DATABASE_URL
if (isolatedUrl) {
  const target = new URL(isolatedUrl)
  if (
    target.protocol !== 'postgresql:' ||
    target.hostname !== '127.0.0.1' ||
    target.port !== '55434' ||
    target.pathname !== '/favorites_verification'
  ) {
    throw new Error('Requires isolated 127.0.0.1:55434/favorites_verification database')
  }
}
const databaseName = `rating_fixture_${randomUUID().replaceAll('-', '')}`
const fixtureUrl = isolatedUrl ? new URL(isolatedUrl) : null
if (fixtureUrl) fixtureUrl.pathname = `/${databaseName}`
const admin = isolatedUrl ? new PrismaClient({ datasourceUrl: isolatedUrl }) : null
const db = fixtureUrl ? new PrismaClient({ datasourceUrl: fixtureUrl.toString() }) : null
const context = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return context.db
  }
}))
import { getArtworkRating, setArtworkRating } from '@/services/artwork-rating-service'

const migrationName = '20261022140000_artwork_rating_levels'
const dbPackage = path.resolve(process.cwd(), '../pixishelf-db')
const user = 'rating-history-a'
const other = 'rating-history-b'
const historyCreatedAt = new Date('2025-03-01T02:03:04.000Z')
const historyUpdatedAt = new Date('2025-09-11T12:13:14.000Z')
let temporaryDirectory = ''
let databaseCreated = false
let artworkId = 0
let emptyArtworkId = 0
let historyIds: number[] = []

function deploy() {
  execFileSync(
    process.execPath,
    [
      path.join(dbPackage, 'scripts/run-prisma.mjs'),
      'migrate',
      'deploy',
      '--schema',
      path.join(temporaryDirectory, 'schema.prisma')
    ],
    {
      cwd: dbPackage,
      env: { ...process.env, DATABASE_URL: fixtureUrl!.toString() },
      stdio: 'pipe',
      timeout: 120_000,
      windowsHide: true
    }
  )
}

async function count(id: number) {
  return (await db!.artwork.findUniqueOrThrow({ where: { id }, select: { likeCount: true } })).likeCount
}

describe.skipIf(!isolatedUrl).sequential('rating upgrade and writes in isolated PostgreSQL', () => {
  beforeAll(async () => {
    await admin!.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`)
    databaseCreated = true
    context.db = db
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-rating-migration-'))
    await fs.copyFile(path.join(dbPackage, 'prisma/schema.prisma'), path.join(temporaryDirectory, 'schema.prisma'))
    const migrationsDirectory = path.join(temporaryDirectory, 'migrations')
    await fs.mkdir(migrationsDirectory)
    for (const entry of await fs.readdir(path.join(dbPackage, 'prisma/migrations'), { withFileTypes: true })) {
      if (entry.name === migrationName) continue
      await fs.cp(path.join(dbPackage, 'prisma/migrations', entry.name), path.join(migrationsDirectory, entry.name), {
        recursive: entry.isDirectory()
      })
    }
    // Deploy the real historical chain before inserting data; do not synthesize an approximate schema.
    deploy()
    await db!.userBA.createMany({ data: [{ id: user }, { id: other }] })
    artworkId = (await db!.artwork.create({ data: { title: 'historical rating fixture' } })).id
    emptyArtworkId = (await db!.artwork.create({ data: { title: 'historical empty fixture' } })).id
    const rows = await db!.$queryRaw<Array<{ id: number }>>`
      INSERT INTO "ArtworkLike" ("userId", "artworkId", "createdAt", "updatedAt")
      VALUES (${user}, ${artworkId}, ${historyCreatedAt}, ${historyUpdatedAt}),
             (${other}, ${artworkId}, ${historyCreatedAt}, ${historyUpdatedAt})
      RETURNING id
    `
    historyIds = rows.map(({ id }) => id)
    // Simulate historical derived-count drift on both populated and empty works.
    await db!.artwork.updateMany({ where: { id: { in: [artworkId, emptyArtworkId] } }, data: { likeCount: 19 } })
    await fs.cp(
      path.join(dbPackage, 'prisma/migrations', migrationName),
      path.join(migrationsDirectory, migrationName),
      {
        recursive: true
      }
    )
    deploy()
  }, 180_000)

  afterAll(async () => {
    await db?.$disconnect()
    if (admin && databaseCreated) {
      if (!/^rating_fixture_[a-f0-9]{32}$/u.test(databaseName)) throw new Error('Unsafe fixture database cleanup')
      await admin.$executeRawUnsafe(`DROP DATABASE "${databaseName}"`)
    }
    await admin?.$disconnect()
    if (temporaryDirectory) {
      const resolved = path.resolve(temporaryDirectory)
      if (
        path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
        !path.basename(resolved).startsWith('pixishelf-rating-migration-')
      ) {
        throw new Error('Unsafe migration fixture directory cleanup')
      }
      await fs.rm(resolved, { recursive: true, force: true })
    }
  })

  it('preserves historical identities and timestamps, maps likes to 2, and reconciles counts', async () => {
    const rows = await db!.artworkLike.findMany({ where: { artworkId }, orderBy: { id: 'asc' } })
    expect(rows.map(({ id }) => id)).toEqual(historyIds)
    expect(rows.map(({ userId }) => userId)).toEqual([user, other])
    for (const row of rows) {
      expect(row.level).toBe(2)
      expect(row.createdAt).toEqual(historyCreatedAt)
      expect(row.updatedAt).toEqual(historyUpdatedAt)
    }
    expect(await count(artworkId)).toBe(2)
    expect(await count(emptyArtworkId)).toBe(0)
    expect(await db!.artworkLike.count({ where: { artworkId: emptyArtworkId } })).toBe(0)
    const migrations = await db!.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name = ${migrationName}
    `
    expect(migrations).toHaveLength(1)
    expect(migrations[0]?.finished_at).toBeInstanceOf(Date)
  })

  it('keeps counts exact across all 25 transitions and repeated explicit writes', async () => {
    const levels = [null, 1, 2, 3, 4] as const
    for (const from of levels) {
      for (const to of levels) {
        await setArtworkRating(user, artworkId, from)
        const result = await setArtworkRating(user, artworkId, to)
        expect(result.level).toBe(to)
        expect(result.isLike).toBe(to !== null && to >= 2)
        expect(await count(artworkId)).toBe(1 + Number(to !== null && to >= 2))
        expect(await setArtworkRating(user, artworkId, to)).toEqual(result)
        expect(await getArtworkRating(user, artworkId)).toEqual(result)
        expect(await getArtworkRating(other, artworkId)).toMatchObject({ level: 2, isLike: true })
      }
    }
  })

  it('rejects illegal levels and duplicate account ratings without changing count', async () => {
    const before = await count(artworkId)
    for (const level of [0, 5, -1]) {
      await expect(
        db!
          .$executeRaw`UPDATE "ArtworkLike" SET level = ${level} WHERE "userId" = ${user} AND "artworkId" = ${artworkId}`
      ).rejects.toThrow()
      expect(await count(artworkId)).toBe(before)
    }
    await expect(db!.artworkLike.create({ data: { userId: user, artworkId, level: 3 } })).rejects.toThrow()
    expect(await count(artworkId)).toBe(before)
  })

  it('handles ownership moves and account cascades using the threshold contribution', async () => {
    const third = await db!.userBA.create({ data: { id: 'rating-cascade-user' } })
    const rating = await db!.artworkLike.create({ data: { userId: third.id, artworkId, level: 4 } })
    expect(await count(artworkId)).toBe(3)
    await db!.artworkLike.update({ where: { id: rating.id }, data: { artworkId: emptyArtworkId } })
    expect(await count(artworkId)).toBe(2)
    expect(await count(emptyArtworkId)).toBe(1)
    await db!.userBA.delete({ where: { id: third.id } })
    expect(await count(emptyArtworkId)).toBe(0)
    expect(await db!.artworkLike.findUnique({ where: { id: rating.id } })).toBeNull()
  })

  it('does not recount child ratings when a parent artwork ID cascades', async () => {
    const source = await db!.artwork.create({ data: { title: 'rating parent cascade fixture' } })
    const target = await db!.artwork.create({ data: { title: 'rating reserved ID fixture' } })
    await db!.artwork.delete({ where: { id: target.id } })
    await db!.artworkLike.createMany({
      data: [
        { artworkId: source.id, userId: user, level: 4 },
        { artworkId: source.id, userId: other, level: 1 }
      ]
    })
    expect(await count(source.id)).toBe(1)
    await db!.artwork.update({ where: { id: source.id }, data: { id: target.id } })
    expect(await count(target.id)).toBe(1)
    expect(await db!.artworkLike.count({ where: { artworkId: target.id } })).toBe(2)
    await db!.artwork.delete({ where: { id: target.id } })
    expect(await db!.artworkLike.count({ where: { artworkId: target.id } })).toBe(0)
  })

  it('preserves personal ratings through media edits and recycle, blocks writes until restore, and cascades permanent deletion', async () => {
    const artwork = await db!.artwork.create({ data: { title: 'rating lifecycle fixture' } })
    await setArtworkRating(user, artwork.id, 3)
    const original = await db!.artworkLike.findUniqueOrThrow({
      where: { userId_artworkId: { userId: user, artworkId: artwork.id } }
    })
    const media = await db!.image.create({
      data: { artworkId: artwork.id, path: '/synthetic/rating.jpg', sortOrder: 0 }
    })
    await db!.image.update({ where: { id: media.id }, data: { sortOrder: 1 } })
    await db!.image.delete({ where: { id: media.id } })
    await db!.artwork.update({
      where: { id: artwork.id },
      data: { title: 'refreshed fixture', mediaRevision: { increment: 1 }, archiveLifecycleState: 'TRASHED' }
    })
    await expect(setArtworkRating(user, artwork.id, 4)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(getArtworkRating(user, artwork.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await db!.artworkLike.findUnique({ where: { id: original.id } })).toEqual(original)
    await db!.artwork.update({ where: { id: artwork.id }, data: { archiveLifecycleState: 'ACTIVE' } })
    expect(await getArtworkRating(user, artwork.id)).toMatchObject({ level: 3, isLike: true })
    await db!.artwork.update({ where: { id: artwork.id }, data: { deletedAt: new Date() } })
    await expect(setArtworkRating(user, artwork.id, null)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await db!.artwork.delete({ where: { id: artwork.id } })
    expect(await db!.artworkLike.findUnique({ where: { id: original.id } })).toBeNull()
  })
})
