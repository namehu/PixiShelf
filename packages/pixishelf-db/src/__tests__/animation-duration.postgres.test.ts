import { PrismaClient } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  beginAnimationDurationSourceWrite,
  finishAnimationDurationSourceWrite,
  getAnimationDurationInventory,
  invalidateAnimationDurationSource,
  listAnimationDurationCandidates,
  listDueAnimationDurationRetries,
  publishAnimationDurationProbe,
  retryAnimationDurationFailures,
  type AnimationDurationFileState
} from '../animation-duration'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe : describe.skip
const database = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const rollback = new Error('rollback animation duration fixture')
const now = new Date('2026-09-24T00:00:00.000Z')
const state: AnimationDurationFileState = {
  size: 123n,
  mtimeMs: 1_000n,
  ctimeMs: 2_000n,
  deviceId: 3n,
  inode: 4n
}

describePostgres('animation duration publication and source fencing', () => {
  it('limits candidates, inventory and manual retries to classified animated WebP', async () => {
    try {
      await database!.$transaction(async (tx) => {
        const prefix = `/probe-scope-${Date.now()}-`
        const baseline = await getAnimationDurationInventory(tx, { now })
        const images = await Promise.all([
          tx.image.create({ data: { path: `${prefix}unknown.webp`, webpAnimationStatus: null } }),
          tx.image.create({ data: { path: `${prefix}pending.webp`, webpAnimationStatus: 0 } }),
          tx.image.create({ data: { path: `${prefix}static.webp`, webpAnimationStatus: 1 } }),
          tx.image.create({ data: { path: `${prefix}animated.webp`, webpAnimationStatus: 2 } })
        ])
        const [unknown, pending, staticImage, animated] = images
        for (const image of [unknown, pending, staticImage, animated]) {
          await tx.imageAnimationMetadata.create({ data: {
            imageId: image.id, status: 'FAILED', nextRetryAt: now, failureCode: 'ENOENT'
          } })
        }
        const due = await listDueAnimationDurationRetries(tx, { limit: 100, now })
        expect(due.map((item) => item.id)).toContain(animated.id)
        expect(due.map((item) => item.id)).not.toContain(unknown.id)
        expect(due.map((item) => item.id)).not.toContain(pending.id)
        expect(due.map((item) => item.id)).not.toContain(staticImage.id)
        const inventory = await getAnimationDurationInventory(tx, { now })
        expect(inventory.totalCount - baseline.totalCount).toBe(1)
        expect(inventory.dueCount - baseline.dueCount).toBe(1)
        expect(inventory.failedCount - baseline.failedCount).toBe(1)
        expect(inventory.retryPendingCount - baseline.retryPendingCount).toBe(0)
        expect(inventory.writePendingCount - baseline.writePendingCount).toBe(0)
        await tx.imageAnimationMetadata.updateMany({
          where: { imageId: { in: images.map((item) => item.id) } },
          data: { nextRetryAt: new Date(now.getTime() + 60_000) }
        })
        const waiting = await getAnimationDurationInventory(tx, { now })
        expect(waiting.dueCount - baseline.dueCount).toBe(0)
        expect(waiting.retryPendingCount - baseline.retryPendingCount).toBe(1)
        await tx.imageAnimationMetadata.updateMany({
          where: { imageId: { in: images.map((item) => item.id) } }, data: { writeInProgress: true }
        })
        const writing = await getAnimationDurationInventory(tx, { now })
        expect(writing.retryPendingCount - baseline.retryPendingCount).toBe(0)
        expect(writing.writePendingCount - baseline.writePendingCount).toBe(1)
        await tx.imageAnimationMetadata.updateMany({
          where: { imageId: { in: images.map((item) => item.id) } },
          data: { writeInProgress: false, nextRetryAt: now }
        })
        expect(await retryAnimationDurationFailures(tx, { imageIds: images.map((item) => item.id) })).toBe(1)
        const candidates = await listAnimationDurationCandidates(tx, { afterImageId: 0, limit: 100, now })
        expect(candidates.map((item) => item.id)).toContain(animated.id)
        expect(candidates.map((item) => item.id)).not.toContain(unknown.id)
        expect(candidates.map((item) => item.id)).not.toContain(pending.id)
        expect(candidates.map((item) => item.id)).not.toContain(staticImage.id)

        // The detector can classify a previously unknown low ID after a job
        // checkpoint; it joins the next forward sweep without a new row.
        await tx.image.update({ where: { id: unknown.id }, data: { webpAnimationStatus: 2, mediaType: 'ANIMATION' } })
        expect((await listAnimationDurationCandidates(tx, { afterImageId: 0, limit: 100, now }))
          .some((item) => item.id === unknown.id)).toBe(true)
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
  })

  it('publishes once, skips unchanged sources and rejects stale or active writes', async () => {
    try {
      await database!.$transaction(async (tx) => {
        const image = await tx.image.create({ data: { path: `/probe-${Date.now()}-a.webp`, size: state.size, webpAnimationStatus: 2 } })
        const candidates = await listAnimationDurationCandidates(tx, { afterImageId: image.id - 1, limit: 100, now })
        expect(candidates.some((candidate) => candidate.id === image.id)).toBe(true)

        const published = await publishAnimationDurationProbe(tx, {
          imageId: image.id,
          expectedPath: image.path,
          expectedRevision: 0,
          preState: state,
          postState: state,
          result: { status: 'READY', format: 'WEBP', durationMs: 1_234n, frameCount: 1, loopCount: 0 },
          now
        })
        expect(published).toBe(true)
        expect((await listAnimationDurationCandidates(tx, { afterImageId: image.id - 1, limit: 100, now })).some((candidate) => candidate.id === image.id)).toBe(false)

        const revision = await beginAnimationDurationSourceWrite(tx, { imageId: image.id })
        expect(revision).toBe(1)
        // A rescan can observe a partial chunk's size. It must not consume the
        // writer's token or release the gate before the final chunk is durable.
        await tx.image.update({ where: { id: image.id }, data: { size: state.size + 1n } })
        expect(await invalidateAnimationDurationSource(tx, { imageId: image.id })).toBe(revision)
        expect(await tx.imageAnimationMetadata.findUniqueOrThrow({ where: { imageId: image.id } }))
          .toMatchObject({ sourceRevision: revision, writeInProgress: true })
        expect(await publishAnimationDurationProbe(tx, {
          imageId: image.id,
          expectedPath: image.path,
          expectedRevision: 0,
          preState: state,
          postState: state,
          result: { status: 'READY', format: 'WEBP', durationMs: 999n, frameCount: 1, loopCount: 0 },
          now
        })).toBe(false)
        expect(await finishAnimationDurationSourceWrite(tx, { imageId: image.id, expectedRevision: 0 })).toBe(false)
        expect(await finishAnimationDurationSourceWrite(tx, { imageId: image.id, expectedRevision: revision as number })).toBe(true)
        expect(await publishAnimationDurationProbe(tx, {
          imageId: image.id,
          expectedPath: image.path,
          expectedRevision: revision as number,
          preState: state,
          postState: { ...state, mtimeMs: 1_001n },
          result: { status: 'READY', format: 'WEBP', durationMs: 999n, frameCount: 1, loopCount: 0 },
          now
        })).toBe(false)
        expect(await publishAnimationDurationProbe(tx, {
          imageId: image.id,
          expectedPath: image.path,
          expectedRevision: revision as number,
          preState: state,
          postState: state,
          result: { status: 'READY', format: 'WEBP', durationMs: 999n, frameCount: 1, loopCount: 0 },
          now
        })).toBe(true)
        expect((await tx.imageAnimationMetadata.findUniqueOrThrow({ where: { imageId: image.id } })).durationMs).toBe(999n)
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
  })

  it('persists bounded retries, permits manual retry, and cascades when Image is deleted', async () => {
    try {
      await database!.$transaction(async (tx) => {
        const image = await tx.image.create({ data: { path: `/probe-${Date.now()}-b.webp`, webpAnimationStatus: 2 } })
        for (const [attempt, delay] of [[1, 60_000], [2, 600_000], [3, null]] as const) {
          const attemptNow = new Date(now.getTime() + attempt * 700_000)
          expect(await publishAnimationDurationProbe(tx, {
            imageId: image.id,
            expectedPath: image.path,
            expectedRevision: 0,
            result: { status: 'FAILED', failureCode: 'SOURCE_READ_ERROR', transient: true },
            now: attemptNow
          })).toBe(true)
          const metadata = await tx.imageAnimationMetadata.findUniqueOrThrow({ where: { imageId: image.id } })
          expect(metadata.attemptCount).toBe(attempt)
          expect(metadata.nextRetryAt?.getTime() ?? null).toBe(delay === null ? null : attemptNow.getTime() + delay)
        }
        expect((await getAnimationDurationInventory(tx, { now })).failedPermanentCount).toBeGreaterThanOrEqual(1)
        expect(await retryAnimationDurationFailures(tx, { imageIds: [image.id] })).toBe(1)
        const pending = await tx.imageAnimationMetadata.findUniqueOrThrow({ where: { imageId: image.id } })
        expect(pending).toMatchObject({ status: 'PENDING', attemptCount: 0, sourceRevision: 1 })
        expect(await invalidateAnimationDurationSource(tx, { imageId: image.id })).toBe(2)
        await tx.image.delete({ where: { id: image.id } })
        expect(await tx.imageAnimationMetadata.findUnique({ where: { imageId: image.id } })).toBeNull()
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
  })
})
