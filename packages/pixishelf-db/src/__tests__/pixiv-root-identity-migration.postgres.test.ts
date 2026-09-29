import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { afterAll, describe, expect, it } from 'vitest'

const url =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const database = url ? new PrismaClient({ datasourceUrl: url }) : null
const rollback = new Error('rollback isolated root identity migration')

describe.skipIf(!database)('Pixiv root UUID expand migration', () => {
  afterAll(async () => database?.$disconnect())
  it.each([false, true])(
    'adds nullable UUID without changing legacy state or inventory (existing=%s)',
    async (existing) => {
      const sql = await readFile(
        new URL('../../prisma/migrations/20260911120000_add_pixiv_root_identity/migration.sql', import.meta.url),
        'utf8'
      )
      const schema = `root_identity_${randomUUID().replaceAll('-', '')}`
      await expect(
        database!.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`)
          await tx.$executeRawUnsafe(
            'CREATE TABLE pixiv_metadata_inventory_state (id TEXT PRIMARY KEY, status TEXT, "rootDeviceId" BIGINT, "rootInode" BIGINT, "baselineGeneration" INT)'
          )
          await tx.$executeRawUnsafe(
            'CREATE TABLE pixiv_metadata_inventory (id TEXT PRIMARY KEY, "processedContentHash" TEXT)'
          )
          if (existing) {
            await tx.$executeRawUnsafe(
              "INSERT INTO pixiv_metadata_inventory_state VALUES ('pixiv', 'READY', 59, 59277, 7)"
            )
            await tx.$executeRawUnsafe("INSERT INTO pixiv_metadata_inventory VALUES ('retained', 'unchanged')")
          }
          for (const statement of sql.trim().split(/;\s*(?=COMMENT\b)/)) await tx.$executeRawUnsafe(statement)
          expect(await tx.$queryRawUnsafe('SELECT * FROM pixiv_metadata_inventory_state')).toEqual(
            existing
              ? [
                  {
                    id: 'pixiv',
                    status: 'READY',
                    rootDeviceId: 59n,
                    rootInode: 59277n,
                    baselineGeneration: 7,
                    rootIdentity: null
                  }
                ]
              : []
          )
          expect(await tx.$queryRawUnsafe('SELECT * FROM pixiv_metadata_inventory')).toEqual(
            existing ? [{ id: 'retained', processedContentHash: 'unchanged' }] : []
          )
          throw rollback
        })
      ).rejects.toBe(rollback)
      expect(
        await database!.$queryRawUnsafe(
          'SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1',
          schema
        )
      ).toEqual([])
    }
  )
})
