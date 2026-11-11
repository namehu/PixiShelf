import { randomUUID } from 'node:crypto'
import { captureArtworkDedupSources, type Prisma, type PrismaClient } from '@pixishelf/db'
import { serializeArtworkDedupSourceSnapshot } from '@pixishelf/job-contracts'

export async function readyItemData(
  database: PrismaClient,
  externalId: string,
  now: Date
): Promise<Prisma.ArchiveIntakeItemCreateWithoutSubmissionInput> {
  const resolved = resolvedArchive(externalId)
  return {
    submittedUrl: `https://e-hentai.org/g/${externalId}/privatetoken/`,
    normalizedUrlHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    status: 'READY',
    providerKey: resolved.providerKey,
    externalId,
    dedupSourceSnapshot: await sourceProof(database, externalId),
    canonicalUrl: resolved.canonicalUrl,
    resolvedTitle: resolved.title,
    pageCount: 1,
    resolvedSnapshot: JSON.parse(JSON.stringify(resolved)) as Prisma.InputJsonValue,
    metadataHash: 'a'.repeat(64),
    resolutionKind: 'NEW',
    resolvedAt: now,
    expiresAt: new Date(now.getTime() + 60_000)
  }
}

function resolvedArchive(externalId: string) {
  return {
    providerKey: 'test-provider',
    externalId,
    canonicalUrl: `https://e-hentai.org/g/${externalId}/privatetoken/`,
    locator: { token: 'privatetoken' },
    title: `Gallery ${externalId}`,
    titleAliases: [],
    description: null,
    category: null,
    uploader: null,
    thumbnailUrl: null,
    postedAt: null,
    tags: [],
    relationships: [],
    media: [
      {
        index: 0,
        sourcePageUrl: `https://e-hentai.org/s/privatepage/${externalId}-1`,
        locator: { token: 'privatepage' },
        expectedFilename: '0001'
      }
    ],
    normalizedMetadata: { titles: { display: `Gallery ${externalId}` } },
    rawMetadata: { token: 'privatetoken' },
    warnings: [],
    creatorBucket: 'test-creator'
  }
}

export async function archiveImportData(
  database: PrismaClient,
  importId: string,
  jobId: string,
  externalId: string
): Promise<Prisma.ArchiveImportUncheckedCreateInput> {
  const resolved = resolvedArchive(externalId)
  return {
    id: importId,
    systemJobId: jobId,
    providerKey: resolved.providerKey,
    externalId,
    dedupSourceSnapshot: await sourceProof(database, externalId),
    submittedUrl: resolved.canonicalUrl,
    canonicalUrl: resolved.canonicalUrl,
    locator: resolved.locator,
    requestedQuality: 'ORIGINAL',
    selectedQuality: 'ORIGINAL',
    normalizedMetadata: resolved.normalizedMetadata,
    rawMetadata: resolved.rawMetadata,
    metadataHash: 'a'.repeat(64),
    creatorBucket: resolved.creatorBucket,
    stagingPath: `.archive-staging/${importId}`,
    totalItems: 1
  }
}

export async function sourceProof(database: PrismaClient, externalId: string, providerKey = 'test-provider') {
  const sources = await database.$transaction((tx) =>
    captureArtworkDedupSources(tx, { identities: [{ kind: 'PROVIDER', providerKey, externalId }] })
  )
  return serializeArtworkDedupSourceSnapshot(sources)
}
