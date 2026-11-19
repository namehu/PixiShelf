import type { PrismaClient } from '@pixishelf/db'

export async function seedSharedGallery(
  database: PrismaClient,
  {
    prefix,
    sharedExternalId,
    suffix,
    uploaderUid,
    artistId
  }: {
    prefix: string
    sharedExternalId: string
    suffix: string
    uploaderUid: string
    artistId?: number
  }
) {
  const sourceId = `${prefix}-source-${suffix}`
  const runId = `${prefix}-run-${suffix}`
  const jobId = `${prefix}-job-${suffix}`
  const scanItemId = `${prefix}-scan-item-${suffix}`
  const catalogItemId = `${prefix}-catalog-item-${suffix}`
  await database.archiveUploaderSource.create({
    data: {
      id: sourceId,
      providerKey: 'e-hentai',
      defaultCreators: artistId ? { create: { artistId } } : undefined,
      identityKind: 'UID',
      identityValue: uploaderUid,
      normalizedIdentity: uploaderUid,
      displayName: `Uploader ${suffix}`
    }
  })
  await database.systemJob.create({
    data: {
      id: jobId,
      type: 'ARCHIVE_UPLOADER_SCAN',
      executionLane: 'ARCHIVE_RESOLVE',
      definitionVersion: 1,
      status: 'COMPLETED',
      triggerSource: 'MANUAL',
      payload: { scanRunId: runId },
      queuePriority: 20,
      effectivePriority: 20,
      availableAt: new Date('2026-09-02T00:00:00.000Z'),
      finishedAt: new Date('2026-09-02T00:01:00.000Z'),
      progress: 100
    }
  })
  await database.archiveUploaderScanRun.create({
    data: {
      id: runId,
      sourceId,
      systemJobId: jobId,
      mode: 'LATEST',
      searchIdentityKind: 'UID',
      searchIdentityValue: uploaderUid,
      status: 'COMPLETED',
      itemCount: 1,
      newCount: 1,
      finishedAt: new Date('2026-09-02T00:01:00.000Z')
    }
  })
  await database.archiveUploaderScanItem.create({
    data: {
      id: scanItemId,
      runId,
      providerKey: 'e-hentai',
      externalId: sharedExternalId,
      canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/privatetoken/`,
      title: 'Shared gallery',
      thumbnailUrl: 'https://ehgt.org/thumb.jpg?secret=1',
      uploaderName: `Uploader ${suffix}`,
      postedAt: new Date('2026-09-01T00:00:00.000Z'),
      metadataFingerprint: 'a'.repeat(64),
      relationships: {},
      classification: 'NEW'
    }
  })
  await database.archiveUploaderCatalogItem.create({
    data: {
      id: catalogItemId,
      sourceId,
      providerKey: 'e-hentai',
      externalId: sharedExternalId,
      canonicalUrl: `https://e-hentai.org/g/${sharedExternalId}/privatetoken/`,
      title: 'Shared gallery',
      thumbnailUrl: 'https://ehgt.org/thumb.jpg?secret=1',
      uploaderName: `Uploader ${suffix}`,
      postedAt: new Date('2026-09-01T00:00:00.000Z'),
      relationships: {},
      classification: 'NEW',
      comparisonKnown: true,
      comparisonFingerprint: 'a'.repeat(64),
      firstSeenAt: new Date('2026-09-02T00:01:00.000Z'),
      lastSeenAt: new Date('2026-09-02T00:01:00.000Z'),
      lastScanRunId: runId
    }
  })
  return { sourceId, runId, jobId, scanItemId, catalogItemId }
}
