import { ARCHIVE_JOB_TYPES } from '@pixishelf/job-contracts'
import type { Prisma } from '@pixishelf/db'

export const logicalArchiveSelect = { archiveImport: { select: { id: true, createdAt: true } } } as const

type LogicalRecord = { id: string; createdAt: Date; archiveImport: { id: string; createdAt: Date } | null }
export type LogicalCursor = { id: string; createdAt: string }

export function logicalJobIdentity(record: LogicalRecord) {
  return record.archiveImport ?? record
}

// Each side applies its stable business cursor in SQL before LIMIT. Merging two
// bounded ordered prefixes yields the same page as a union ordered by business identity.
export async function readLogicalJobPage<T extends LogicalRecord>(
  read: (args: {
    where: Prisma.SystemJobWhereInput
    orderBy: Prisma.SystemJobOrderByWithRelationInput[]
    take: number
  }) => Promise<T[]>,
  options: {
    where: Prisma.SystemJobWhereInput
    take: number
    cursor?: LogicalCursor
    createdFrom?: string
    createdTo?: string
  }
): Promise<T[]> {
  const createdAt =
    options.createdFrom || options.createdTo
      ? {
          ...(options.createdFrom ? { gte: new Date(options.createdFrom) } : {}),
          ...(options.createdTo ? { lt: new Date(options.createdTo) } : {})
        }
      : undefined
  const cursor = options.cursor
    ? {
        OR: [
          { createdAt: { lt: new Date(options.cursor.createdAt) } },
          { createdAt: new Date(options.cursor.createdAt), id: { lt: options.cursor.id } }
        ]
      }
    : {}
  const [ordinary, archives] = await Promise.all([
    read({
      where: { AND: [options.where, { type: { notIn: [...ARCHIVE_JOB_TYPES] } }, { createdAt, ...cursor }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.take
    }),
    read({
      where: {
        AND: [
          options.where,
          { type: { in: [...ARCHIVE_JOB_TYPES] } },
          { archiveImport: { is: { createdAt, ...cursor } } }
        ]
      },
      orderBy: [{ archiveImport: { createdAt: 'desc' } }, { archiveImport: { id: 'desc' } }],
      take: options.take
    })
  ])
  return [...ordinary, ...archives]
    .sort((a, b) => {
      const left = logicalJobIdentity(a)
      const right = logicalJobIdentity(b)
      return (
        right.createdAt.getTime() - left.createdAt.getTime() || (left.id === right.id ? 0 : left.id < right.id ? 1 : -1)
      )
    })
    .slice(0, options.take)
}
