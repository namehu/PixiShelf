import { Prisma, PrismaClient } from '@prisma/client'

export { Prisma, PrismaClient }

const latestRequiredMigration = '20260814100000_add_worker_instances'

const requiredQueueObjects = [
  'derived_media_gc_entries',
  'job_resource_leases',
  'system_job_events',
  'worker_instances'
] as const

export function createDatabaseClient(options?: Prisma.PrismaClientOptions): PrismaClient {
  return new PrismaClient(options)
}

export async function disconnectDatabase(client: PrismaClient): Promise<void> {
  await client.$disconnect()
}

export async function assertBackgroundQueueSchema(client: PrismaClient): Promise<void> {
  let columnRows: Array<{ columnName: string }>
  let tableRows: Array<{ tableName: string }>
  let migrationRows: Array<{ migrationName: string }>

  try {
    ;[columnRows, tableRows, migrationRows] = await Promise.all([
      client.$queryRaw<Array<{ columnName: string }>>(Prisma.sql`
        SELECT column_name AS "columnName"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'system_jobs'
          AND column_name = 'definitionVersion'
      `),
      client.$queryRaw<Array<{ tableName: string }>>(Prisma.sql`
        SELECT table_name AS "tableName"
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name IN (${Prisma.join(requiredQueueObjects)})
      `),
      client.$queryRaw<Array<{ migrationName: string }>>(Prisma.sql`
        SELECT migration_name AS "migrationName"
        FROM "_prisma_migrations"
        WHERE migration_name = ${latestRequiredMigration}
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      `)
    ])
  } catch {
    throw new Error('Unable to verify the background queue database schema')
  }

  const missingObjects: string[] = []
  if (!columnRows.some(({ columnName }) => columnName === 'definitionVersion')) {
    missingObjects.push('system_jobs.definitionVersion')
  }

  const existingTables = new Set(tableRows.map(({ tableName }) => tableName))
  for (const tableName of requiredQueueObjects) {
    if (!existingTables.has(tableName)) {
      missingObjects.push(tableName)
    }
  }

  if (!migrationRows.some(({ migrationName }) => migrationName === latestRequiredMigration)) {
    missingObjects.push(`migration:${latestRequiredMigration}`)
  }

  if (missingObjects.length > 0) {
    throw new Error(`Background queue schema is not ready: missing ${missingObjects.join(', ')}`)
  }
}
