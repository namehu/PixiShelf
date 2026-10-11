// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { PrismaClient } from '@prisma/client'

// Apply the complete migration history with migrate deploy to a disposable local
// database. Never fall back to the application's DATABASE_URL.
const databaseUrl = process.env.PIXISHELF_TEST_DATABASE_URL

type Fixture = {
  prisma: PrismaClient
  artworkId: number
  createArtwork: () => Promise<number>
  createImages: (count: number, artworkId?: number | null) => Promise<number[]>
}

const test = it.extend<{ fixture: Fixture }>({
  fixture: async ({ task }, use) => {
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl! })
    const artistIds: number[] = []
    const artworkIds: number[] = []
    const imageIds: number[] = []
    const token = randomUUID()
    const failures: unknown[] = []
    try {
      const artist = await prisma.artist.create({ data: { name: `image-count-${token}: ${task.name}` } })
      artistIds.push(artist.id)
      const createArtwork = async () => {
        const artwork = await prisma.artwork.create({ data: { title: `image-count-${token}`, artistId: artist.id } })
        artworkIds.push(artwork.id)
        return artwork.id
      }
      const artworkId = await createArtwork()
      const createImages = async (count: number, owner: number | null = artworkId) => {
        const rows = await prisma.image.createManyAndReturn({
          data: Array.from({ length: count }, (_, index) => ({
            path: `image-count-${token}/${randomUUID()}.jpg`,
            artworkId: owner,
            sortOrder: index
          })),
          select: { id: true }
        })
        const ids = rows.map(({ id }) => id)
        imageIds.push(...ids)
        return ids
      }
      await use({ prisma, artworkId, createArtwork, createImages })
    } catch (error) {
      failures.push(error)
    } finally {
      // Images may have moved or become ownerless. Track their own IDs, not only
      // artworkId. Artwork deletion releases creator relations before Artist.
      for (const cleanup of [
        () => prisma.image.deleteMany({ where: { id: { in: imageIds } } }),
        () => prisma.artwork.deleteMany({ where: { id: { in: artworkIds } } }),
        () => prisma.artist.deleteMany({ where: { id: { in: artistIds } } }),
        () => prisma.$disconnect()
      ]) {
        try {
          await cleanup()
        } catch (error) {
          failures.push(error)
        }
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Image count fixture setup or cleanup failed')
  }
})

describe.skipIf(!databaseUrl)('Artwork Image Count Trigger', () => {
  test('auto-increments imageCount when adding images', async ({ fixture }) => {
    const { prisma, artworkId, createImages } = fixture
    expect((await prisma.artwork.findUniqueOrThrow({ where: { id: artworkId } })).imageCount).toBe(0)
    await createImages(3)
    expect((await prisma.artwork.findUniqueOrThrow({ where: { id: artworkId } })).imageCount).toBe(3)
  })

  test('auto-decrements imageCount when deleting images', async ({ fixture }) => {
    const { prisma, artworkId, createImages } = fixture
    const [imageId] = await createImages(3)
    await prisma.image.delete({ where: { id: imageId! } })
    expect((await prisma.artwork.findUniqueOrThrow({ where: { id: artworkId } })).imageCount).toBe(2)
  })

  test('handles concurrent image insertions', async ({ fixture }) => {
    const { prisma, artworkId, createImages } = fixture
    // Wait for every writer even if one fails before allowing fixture teardown.
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => createImages(1)))
    const failures = results.filter((result) => result.status === 'rejected')
    expect(failures).toEqual([])
    expect((await prisma.artwork.findUniqueOrThrow({ where: { id: artworkId } })).imageCount).toBe(10)
  })

  test('updates both counts when moving an image to another artwork', async ({ fixture }) => {
    const { prisma, artworkId, createArtwork, createImages } = fixture
    const targetId = await createArtwork()
    const [imageId] = await createImages(3)
    await prisma.image.update({ where: { id: imageId! }, data: { artworkId: targetId } })
    expect((await prisma.artwork.findUniqueOrThrow({ where: { id: artworkId } })).imageCount).toBe(2)
    expect((await prisma.artwork.findUniqueOrThrow({ where: { id: targetId } })).imageCount).toBe(1)
  })

  test('updates counts when an image becomes ownerless and leaves no untracked image', async ({ fixture }) => {
    const { prisma, artworkId, createImages } = fixture
    const [imageId] = await createImages(1)
    await createImages(1, null)
    await prisma.image.update({ where: { id: imageId! }, data: { artworkId: null } })
    expect((await prisma.artwork.findUniqueOrThrow({ where: { id: artworkId } })).imageCount).toBe(0)
    expect((await prisma.image.findUniqueOrThrow({ where: { id: imageId! } })).artworkId).toBeNull()
  })
})
