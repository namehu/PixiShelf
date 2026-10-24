import type { Prisma } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'
import { readExecutorMediaRecoveryDomainSnapshot } from '../media-content-recovery.ts'

describe('archive maintenance recovery revision digest', () => {
  it.each([100, 101, 200])('streams every one of %i revisions in bounded keyset pages', async (count) => {
    const revisions = Array.from({ length: count }, (_, index) => ({
      id: String(index + 1).padStart(6, '0'),
      archivePath: `sources/test/bucket/work/revisions/${index + 1}`,
      trashPath: `.trash/archive/1/${index + 1}`,
      trashedAt: new Date('2026-10-23T00:00:00.000Z'),
      purgeAfter: new Date('2026-11-23T00:00:00.000Z')
    }))
    const findMany = vi.fn(async (args: Prisma.ArchiveRevisionFindManyArgs) => {
      const afterId = (args.where?.id as Prisma.StringFilter | undefined)?.gt
      return revisions.filter((revision) => !afterId || revision.id > afterId).slice(0, args.take ?? 0)
    })
    const transaction = {
      systemJob: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 'maintenance-job',
          type: 'ARCHIVE_MAINTENANCE',
          payload: { action: 'TRASH_ARCHIVE', artworkId: 1 }
        })
      },
      artwork: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: 1,
          createdVia: 'URL_ARCHIVE',
          archiveLifecycleState: 'TRASHING',
          deletedAt: new Date('2026-10-23T00:00:00.000Z'),
          storagePath: null,
          storageKey: null,
          metaSource: 'URL_ARCHIVE'
        })
      },
      archiveRevision: { findMany }
    } as unknown as Prisma.TransactionClient
    const read = () =>
      readExecutorMediaRecoveryDomainSnapshot(transaction, {
        jobId: 'maintenance-job',
        sessionId: 'archive-maintenance:maintenance-job'
      })
    const original = (await read()) as Prisma.JsonObject
    expect(original.revisions).toEqual({
      version: 1,
      count: String(count),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    expect(JSON.stringify(original.revisions).length).toBeLessThan(120)
    expect(findMany).toHaveBeenCalledTimes(Math.floor(count / 100) + 1)
    for (const [index, [args]] of findMany.mock.calls.entries()) {
      expect(args).toMatchObject({
        where: { artworkId: 1 },
        orderBy: { id: 'asc' },
        take: 100,
        select: { id: true, archivePath: true, trashPath: true, trashedAt: true, purgeAfter: true }
      })
      expect(args.where?.id).toEqual(index === 0 ? undefined : { gt: revisions[index * 100 - 1]!.id })
      expect(args.skip).toBeUndefined()
    }
    revisions[count - 1]!.trashPath += '-changed'
    const changed = (await read()) as Prisma.JsonObject
    expect(changed.revisions).toMatchObject({ version: 1, count: String(count) })
    expect(changed.revisions).not.toEqual(original.revisions)
    revisions.push({ ...revisions[count - 1]!, id: String(count + 1).padStart(6, '0') })
    const appended = (await read()) as Prisma.JsonObject
    expect(appended.revisions).toMatchObject({ version: 1, count: String(count + 1) })
    expect(appended.revisions).not.toEqual(changed.revisions)
  })
})
