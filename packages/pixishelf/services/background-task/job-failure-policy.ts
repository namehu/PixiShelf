import type { Prisma } from '@pixishelf/db'

const hiddenChildTypes = [
  'PIXIV_TAG_ENRICHMENT',
  'PIXIV_ARTIST_ENRICHMENT',
  'PIXIV_ARTWORK_ENRICHMENT',
  'PIXIV_SERIES_RECONCILIATION'
]

export const dashboardVisibleWhere = {
  definitionVersion: { gte: 1 },
  NOT: { OR: hiddenChildTypes.map((type) => ({ type, parentJobId: { not: null } })) }
} satisfies Prisma.SystemJobWhereInput

export const unacknowledgedFailureWhere = {
  ...dashboardVisibleWhere,
  status: 'FAILED',
  failureAcknowledgement: { is: null }
} satisfies Prisma.SystemJobWhereInput

export function failureNeedsAttention(job: {
  definitionVersion: number
  type: string
  parentJobId: string | null
  status: string
  failureAcknowledgement: { jobId: string } | null
}) {
  return (
    job.definitionVersion >= 1 &&
    job.status === 'FAILED' &&
    job.failureAcknowledgement === null &&
    !(job.parentJobId !== null && hiddenChildTypes.includes(job.type))
  )
}
