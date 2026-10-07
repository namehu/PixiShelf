import { prisma } from '@/lib/prisma'
import { Prisma } from '@pixishelf/db'
import { ACTIVE_JOB_STATUSES } from '@pixishelf/job-contracts'
import { projectJobTarget } from './job-target'

/** Resolve each target in PostgreSQL; never scan all task history into the App. */
export async function latestMediaJobs(
  type: 'VIDEO_KEYFRAME_GENERATION' | 'VIDEO_STREAMING_OPTIMIZATION',
  imageIds: number[]
) {
  if (!imageIds.length) return []
  const targets = Prisma.join([...new Set(imageIds)].map((id) => Prisma.sql`${JSON.stringify(id)}::jsonb`))
  const order =
    type === 'VIDEO_KEYFRAME_GENERATION'
      ? Prisma.sql`("status"::text IN (${Prisma.join([...ACTIVE_JOB_STATUSES])})) DESC, "updatedAt" DESC, "createdAt" DESC, "id" DESC`
      : Prisma.sql`"createdAt" DESC, "id" DESC`
  const ids = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH candidates AS (
      SELECT DISTINCT ON ("payload" #> '{imageId}') "id", "payload" #> '{imageId}' AS target, "status", "updatedAt", "createdAt"
      FROM system_jobs WHERE "type" = ${type} AND "definitionVersion" > 0 AND "payload" #> '{imageId}' IN (${targets})
      ORDER BY "payload" #> '{imageId}', ${order}
    ), legacy AS (
      SELECT DISTINCT ON ("legacyDisplay" #> '{targetImageId}') "id", "legacyDisplay" #> '{targetImageId}' AS target, "status", "updatedAt", "createdAt"
      FROM system_jobs WHERE "type" = ${type} AND "definitionVersion" = 0 AND "legacyDisplay" #> '{targetImageId}' IN (${targets})
      ORDER BY "legacyDisplay" #> '{targetImageId}', ${order}
    )
    SELECT DISTINCT ON (target) id FROM (SELECT * FROM candidates UNION ALL SELECT * FROM legacy) merged
    ORDER BY target, ${order}
  `)
  const jobs = await prisma.systemJob.findMany({ where: { id: { in: ids.map((row) => row.id) } } })
  return jobs.map(projectJobTarget)
}
