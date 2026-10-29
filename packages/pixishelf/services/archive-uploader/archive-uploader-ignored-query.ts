import { Prisma, type PrismaClient } from '@pixishelf/db'

const ignoredItemWireSelect = {
  id: true,
  providerKey: true,
  externalId: true,
  sourceDisplayName: true,
  title: true,
  thumbnailUrl: true,
  uploaderName: true,
  postedAt: true,
  ignoredAt: true
} satisfies Prisma.ArchiveUploaderIgnoredItemSelect

export type IgnoredItemWire = Prisma.ArchiveUploaderIgnoredItemGetPayload<{ select: typeof ignoredItemWireSelect }>

export async function queryArchiveUploaderIgnoredItems(
  database: PrismaClient,
  input: { sourceId?: string; cursor?: { ignoredAt: Date; id: string } | null; limit: number }
) {
  // sourceId on an ignored record is audit provenance; catalog membership defines the viewing scope.
  const membership = Prisma.sql`EXISTS (
    SELECT 1 FROM "archive_uploader_catalog_items" catalog
    WHERE catalog."sourceId" = ${input.sourceId ?? null}
      AND catalog."providerKey" = ignored."providerKey"
      AND catalog."externalId" = ignored."externalId"
  )`
  const cursor = input.cursor
    ? Prisma.sql`AND (ignored."ignoredAt", ignored.id) < (${input.cursor.ignoredAt}, ${input.cursor.id})`
    : Prisma.empty
  const [rows, totalCount] = input.sourceId
    ? await Promise.all([
        database.$queryRaw<IgnoredItemWire[]>(Prisma.sql`
          SELECT ignored.id, ignored."providerKey", ignored."externalId", ignored."sourceDisplayName",
            ignored.title, ignored."thumbnailUrl", ignored."uploaderName", ignored."postedAt", ignored."ignoredAt"
          FROM "archive_uploader_ignored_items" ignored
          WHERE ${membership} ${cursor}
          ORDER BY ignored."ignoredAt" DESC, ignored.id DESC
          LIMIT ${input.limit + 1}
        `),
        database
          .$queryRaw<{ count: number }[]>(
            Prisma.sql`
          SELECT COUNT(*)::integer AS count FROM "archive_uploader_ignored_items" ignored
          WHERE ${membership}
        `
          )
          .then(([row]) => row!.count)
      ])
    : await Promise.all([
        database.archiveUploaderIgnoredItem.findMany({
          where: input.cursor
            ? {
                OR: [
                  { ignoredAt: { lt: input.cursor.ignoredAt } },
                  { ignoredAt: input.cursor.ignoredAt, id: { lt: input.cursor.id } }
                ]
              }
            : undefined,
          orderBy: [{ ignoredAt: 'desc' }, { id: 'desc' }],
          take: input.limit + 1,
          select: ignoredItemWireSelect
        }),
        database.archiveUploaderIgnoredItem.count()
      ])
  return { rows, totalCount }
}
