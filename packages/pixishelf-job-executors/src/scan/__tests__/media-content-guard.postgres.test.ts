import { cleanupFixtureContentDirectories } from './content-directory-cleanup.ts'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { PrismaClient, type Prisma } from '@pixishelf/db'
import type { ExecutionContext } from '@pixishelf/job-runtime'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureScanMediaDirectory, assertScanMediaDirectory } from '../media-content-guard.ts'
import {
  beginExecutorMediaWrite,
  beginExecutorMediaDirectoryWrites,
  resolveExecutorMediaDirectory,
  publishExecutorMediaWrite,
  assertExecutorMediaWrite
} from '../media-content-write.ts'

const url = process.env.PIXISHELF_TEST_DATABASE_URL ?? process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `executor-content-${randomUUID()}`
let root: string
const context = {
  job: { id: prefix, executionToken: randomUUID(), attempt: 1 },
  mutateInTransaction: (operation: (transaction: Prisma.TransactionClient) => Promise<unknown>) =>
    db!.$transaction(operation)
} as unknown as ExecutionContext

suite('executor persisted media write barriers', () => {
  beforeAll(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'executor-content-')))
  })
  afterAll(async () => {
    if (!db) return
    await db.artwork.deleteMany({ where: { title: { startsWith: prefix } } })
    await cleanupFixtureContentDirectories(db, [root])
    await db.$disconnect()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('blocks a paused new-path write before Image exists and invalidates a scan that began first', async () => {
    const relativeDirectory = `${prefix}/paused`
    await fs.mkdir(path.join(root, relativeDirectory), { recursive: true })
    const snapshot = await captureScanMediaDirectory({ context, scanRoot: root, relativeDirectory })
    const directory = await resolveExecutorMediaDirectory({ context, sourceRoot: root, relativeDirectory })
    const relativePath = `${relativeDirectory}/page.jpg`
    const write = await beginExecutorMediaWrite({
      context,
      directory,
      scope: { kind: 'PATH', relativePath },
      sessionId: `${prefix}:paused`
    })
    await fs.writeFile(path.join(root, relativePath), 'part')
    await expect(captureScanMediaDirectory({ context, scanRoot: root, relativeDirectory })).rejects.toMatchObject({
      code: 'STATE_CONFLICT'
    })
    expect(await db!.image.count({ where: { path: relativePath } })).toBe(0)
    await fs.appendFile(path.join(root, relativePath), '-complete')
    await db!.$transaction((tx) =>
      publishExecutorMediaWrite(tx, write, 'committed', async (tx) => {
        const artwork = await tx.artwork.create({ data: { title: `${prefix}-paused` } })
        await tx.image.create({ data: { artworkId: artwork.id, path: relativePath, size: 13n, sortOrder: 0 } })
      })
    )
    await expect(db!.$transaction((tx) => assertScanMediaDirectory(tx, snapshot))).rejects.toMatchObject({
      code: 'STATE_CONFLICT'
    })
    const fresh = await captureScanMediaDirectory({ context, scanRoot: root, relativeDirectory })
    expect(fresh.generation).toBeGreaterThan(snapshot.generation)
    expect(await db!.image.count({ where: { path: relativePath } })).toBe(1)
  })

  it('rolls publication DML back with the claim and leaves the path unavailable until a verified retry', async () => {
    const relativeDirectory = `${prefix}/atomic`
    const artwork = await db!.artwork.create({ data: { title: `${prefix}-atomic` } })
    const directory = await resolveExecutorMediaDirectory({ context, sourceRoot: root, relativeDirectory })
    const write = await beginExecutorMediaWrite({
      context,
      directory,
      scope: { kind: 'DIRECTORY' },
      sessionId: `${prefix}:atomic`,
      artworkIds: [artwork.id]
    })
    await expect(
      db!.$transaction((tx) =>
        publishExecutorMediaWrite(tx, write, 'committed', async (tx) => {
          await tx.image.create({
            data: { artworkId: artwork.id, path: `${relativeDirectory}/page.jpg`, size: 10n, sortOrder: 0 }
          })
          throw new Error('force rollback')
        })
      )
    ).rejects.toThrow('force rollback')
    expect(await db!.image.count({ where: { artworkId: artwork.id } })).toBe(0)
    await expect(captureScanMediaDirectory({ context, scanRoot: root, relativeDirectory })).rejects.toMatchObject({
      code: 'STATE_CONFLICT'
    })
    await db!.$transaction((tx) => publishExecutorMediaWrite(tx, write, 'verified-rollback', async () => undefined))
    await expect(captureScanMediaDirectory({ context, scanRoot: root, relativeDirectory })).resolves.toBeTruthy()
  })

  it('reuses an exact execution after its write returns but never adopts a different execution', async () => {
    const relativeDirectory = `${prefix}/replay`
    const artwork = await db!.artwork.create({ data: { title: `${prefix}-replay` } })
    const directory = await resolveExecutorMediaDirectory({ context, sourceRoot: root, relativeDirectory })
    const input = {
      context,
      directory,
      scope: { kind: 'DIRECTORY' as const },
      sessionId: `${prefix}:replay`,
      artworkIds: [artwork.id]
    }
    const first = await beginExecutorMediaWrite(input)
    const state = await db!.artworkContentSource.findUniqueOrThrow({ where: { artworkId: artwork.id } })
    const replay = await beginExecutorMediaWrite(input)
    expect(replay).toEqual(first)
    expect(await db!.artworkContentSource.findUniqueOrThrow({ where: { artworkId: artwork.id } })).toEqual(state)
    const next = { ...context, job: { ...context.job, executionToken: randomUUID(), attempt: 2 } }
    await expect(beginExecutorMediaWrite({ ...input, context: next })).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await db!.$transaction((tx) => publishExecutorMediaWrite(tx, replay, 'verified-rollback', async () => undefined))
    await expect(beginExecutorMediaWrite(input)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })

  it('keeps both migration directories claimed across the database path switch until source cleanup', async () => {
    const source = `${prefix}/migration-old`,
      target = `${prefix}/migration-new`
    const artwork = await db!.artwork.create({
      data: {
        title: `${prefix}-migration`,
        images: { create: { path: `${source}/page.jpg`, size: 3n, sortOrder: 0 } }
      },
      include: { images: true }
    })
    const directories = await Promise.all(
      [source, target].map((relativeDirectory) =>
        resolveExecutorMediaDirectory({ context, sourceRoot: root, relativeDirectory })
      )
    )
    const write = await beginExecutorMediaDirectoryWrites({
      context,
      directories,
      sessionId: `${prefix}:migration`,
      artworkIds: [artwork.id]
    })
    await db!.$transaction(async (tx) => {
      await assertExecutorMediaWrite(tx, write)
      await tx.image.update({ where: { id: artwork.images[0]!.id }, data: { path: `${target}/page.jpg` } })
    })
    for (const relativeDirectory of [source, target]) {
      await expect(captureScanMediaDirectory({ context, scanRoot: root, relativeDirectory })).rejects.toMatchObject({
        code: 'STATE_CONFLICT'
      })
    }
    await db!.$transaction((tx) => publishExecutorMediaWrite(tx, write, 'committed', async () => undefined))
    for (const relativeDirectory of [source, target]) {
      await expect(captureScanMediaDirectory({ context, scanRoot: root, relativeDirectory })).resolves.toBeTruthy()
    }
    expect((await db!.image.findUniqueOrThrow({ where: { id: artwork.images[0]!.id } })).path).toBe(
      `${target}/page.jpg`
    )
  })
})
