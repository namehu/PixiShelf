import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { setArchiveUploaderUid } from '../archive-uploader-service'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = `archive-uploader-uid-${randomUUID()}`

describePostgres('archive uploader UID binding PostgreSQL integration', () => {
  afterAll(async () => {
    if (!prisma) return
    await prisma.archiveUploaderSource.deleteMany({ where: { id: { startsWith: prefix } } })
    await prisma.$disconnect()
  })

  it('binds a NAME source in place and preserves its durable catalog', async () => {
    const suffix = randomUUID()
    const sourceId = `${prefix}-source-${suffix}`
    const otherSourceId = `${prefix}-source-other-${suffix}`
    const externalId = BigInt(`0x${suffix.replaceAll('-', '').slice(0, 12)}`).toString()
    const uploaderUid = BigInt(`0x${suffix.replaceAll('-', '').slice(12, 24)}`).toString()
    const discoveredAt = new Date('2026-09-03T00:00:00.000Z')
    await database().archiveUploaderSource.create({
      data: {
        id: sourceId,
        providerKey: 'e-hentai',
        identityKind: 'NAME',
        identityValue: `uploader-${suffix}`,
        normalizedIdentity: `uploader-${suffix}`,
        displayName: `Uploader ${suffix}`,
        latestSeenExternalId: externalId,
        incrementalCursor: 'https://e-hentai.org/?next=1',
        incrementalHeadExternalId: externalId,
        historyCursor: 'https://e-hentai.org/?prev=1',
        lastScanAt: discoveredAt,
        lastSuccessAt: discoveredAt,
        lastErrorCode: 'OLD_ERROR',
        lastErrorMessage: 'old error'
      }
    })
    await database().archiveUploaderCatalogItem.create({
      data: {
        id: `${prefix}-catalog-${suffix}`,
        sourceId,
        providerKey: 'e-hentai',
        externalId,
        canonicalUrl: `https://e-hentai.org/g/${externalId}/private-token/`,
        title: `Gallery ${suffix}`,
        relationships: {},
        classification: 'NEW',
        firstSeenAt: discoveredAt,
        lastSeenAt: discoveredAt
      }
    })
    await database().archiveUploaderSource.create({
      data: {
        id: otherSourceId,
        providerKey: 'e-hentai',
        identityKind: 'NAME',
        identityValue: `other-${suffix}`,
        normalizedIdentity: `other-${suffix}`,
        displayName: `Other ${suffix}`
      }
    })

    await expect(
      setArchiveUploaderUid({ sourceId, uploaderUid }, { database: database(), now: () => discoveredAt })
    ).resolves.toMatchObject({ outcome: 'UPDATED', sourceId, uploaderUid })

    const changed = await database().archiveUploaderSource.findUniqueOrThrow({ where: { id: sourceId } })
    expect(changed).toMatchObject({
      identityKind: 'NAME',
      identityValue: `uploader-${suffix}`,
      uploaderUid,
      uidRevalidationRequiredAt: discoveredAt,
      latestSeenExternalId: null,
      incrementalCursor: null,
      incrementalHeadExternalId: null,
      historyCursor: null,
      lastScanAt: null,
      lastSuccessAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastRunId: null
    })
    await expect(database().archiveUploaderCatalogItem.count({ where: { sourceId } })).resolves.toBe(1)
    await expect(
      setArchiveUploaderUid({ sourceId: otherSourceId, uploaderUid }, { database: database() })
    ).resolves.toMatchObject({ outcome: 'CONFLICT', conflictingSourceId: sourceId })
  })
})

function database() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return prisma
}
