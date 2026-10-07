import type { Prisma } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'
import { enqueueArchiveIntakeItemInTransaction } from '../intake-enqueue.js'
import { isPublishedArchiveUnchanged } from '../metadata-comparison.js'
import { hashResolvedMetadata } from '../providers/e-hentai.js'

const previous = {
  schemaVersion: 1,
  gid: '3902890',
  titles: { display: 'Gallery', aliases: [] },
  fileCount: 1,
  fileSize: 10,
  mediaPlan: [{ index: 0, sourcePageUrl: 'https://e-hentai.org/s/page/3902890-1' }],
  tags: [],
  rating: '4.48',
  relationships: []
}
const updated = { ...previous, tags: [{ namespace: 'female', name: 'sole female' }], rating: '4.49' }
const currentHash = hashResolvedMetadata(previous)
const reference = { id: 'ref-1', archiveRevisions: [{ metadataHash: currentHash }] }

describe('published archive update comparison', () => {
  it('compares the exact published snapshot while retaining the full metadata hashes', async () => {
    const fixture = snapshotFixture(previous)
    expect(hashResolvedMetadata(updated)).not.toBe(currentHash)

    await expect(
      isPublishedArchiveUnchanged(
        fixture.transaction,
        reference,
        { providerKey: 'e-hentai', normalizedMetadata: updated },
        hashResolvedMetadata(updated)
      )
    ).resolves.toBe(true)
    expect(fixture.findUnique).toHaveBeenCalledWith({
      where: { externalRefId_metadataHash: { externalRefId: 'ref-1', metadataHash: currentHash } },
      select: { normalizedMetadata: true }
    })
  })

  it.each([
    { fileCount: 2 },
    { fileSize: 20 },
    { titles: { display: 'New title', aliases: [] } },
    { mediaPlan: [{ index: 0, sourcePageUrl: 'https://e-hentai.org/s/replaced/3902890-1' }] },
    { relationships: [{ type: 'REPLACES', externalId: '3902900' }] }
  ])('still detects archive changes mixed with tags/rating: %j', async (change) => {
    const current = { ...updated, ...change }
    await expect(
      isPublishedArchiveUnchanged(
        snapshotFixture(previous).transaction,
        reference,
        { providerKey: 'e-hentai', normalizedMetadata: current },
        hashResolvedMetadata(current)
      )
    ).resolves.toBe(false)
  })

  it('does not guess unchanged when the published baseline is missing', async () => {
    await expect(
      isPublishedArchiveUnchanged(
        snapshotFixture(null).transaction,
        reference,
        { providerKey: 'e-hentai', normalizedMetadata: updated },
        hashResolvedMetadata(updated)
      )
    ).resolves.toBe(false)
    await expect(
      isPublishedArchiveUnchanged(
        snapshotFixture(previous).transaction,
        { ...reference, archiveRevisions: [] },
        { providerKey: 'e-hentai', normalizedMetadata: updated },
        hashResolvedMetadata(updated)
      )
    ).resolves.toBe(false)
  })

  it('keeps the existing full-hash comparison for other providers', async () => {
    const fixture = snapshotFixture(previous)
    await expect(
      isPublishedArchiveUnchanged(
        fixture.transaction,
        reference,
        { providerKey: 'test', normalizedMetadata: updated },
        hashResolvedMetadata(updated)
      )
    ).resolves.toBe(false)
    expect(fixture.findUnique).not.toHaveBeenCalled()
  })

  it('avoids another database lookup when full metadata hashes already match', async () => {
    const fixture = snapshotFixture(null)
    await expect(
      isPublishedArchiveUnchanged(
        fixture.transaction,
        reference,
        { providerKey: 'e-hentai', normalizedMetadata: previous },
        currentHash
      )
    ).resolves.toBe(true)
    expect(fixture.findUnique).not.toHaveBeenCalled()
  })

  it('uses the same rule during the AUTO enqueue publication race check', async () => {
    const fixture = snapshotFixture(previous)
    const resolved = {
      providerKey: 'e-hentai',
      externalId: previous.gid,
      normalizedMetadata: updated,
      media: [],
      postedAt: null
    }
    const update = vi.fn(async () => ({}))
    const createImport = vi.fn()
    const transaction = {
      ...fixture.transaction,
      archiveIntakeItem: {
        findUnique: vi.fn(async () => ({
          id: 'intake-1',
          status: 'READY',
          providerKey: 'e-hentai',
          externalId: previous.gid,
          resolvedSnapshot: resolved,
          metadataHash: hashResolvedMetadata(updated),
          expiresAt: new Date('2026-10-08T00:00:00Z')
        })),
        update
      },
      archiveImport: { findFirst: vi.fn(async () => null), create: createImport },
      artworkExternalRef: {
        findUnique: vi.fn(async () => ({
          ...reference,
          artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
        }))
      },
      $queryRawUnsafe: vi.fn()
    } as unknown as Prisma.TransactionClient

    await expect(
      enqueueArchiveIntakeItemInTransaction(transaction, 'intake-1', {
        quality: 'ORIGINAL',
        requestedByUserId: null,
        timestamp: new Date('2026-10-07T00:00:00Z'),
        uuid: vi.fn(),
        defaultTagIds: [],
        autoOnly: true
      })
    ).resolves.toEqual({ result: 'SKIPPED', code: 'UNCHANGED' })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'intake-1' },
      data: { status: 'SKIPPED', resolutionKind: 'UNCHANGED' }
    })
    expect(createImport).not.toHaveBeenCalled()
  })
})

function snapshotFixture(metadata: Record<string, unknown> | null) {
  const findUnique = vi.fn(async () => (metadata ? { normalizedMetadata: metadata } : null))
  return {
    findUnique,
    transaction: { artworkSourceSnapshot: { findUnique } } as unknown as Prisma.TransactionClient
  }
}
