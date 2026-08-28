import type { Prisma } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'
import { appendArchiveDefaultTags } from '../publisher.js'

describe('archive publisher default tags', () => {
  it('appends existing configured tags as manual provenance and ignores deleted ids', async () => {
    const transaction = {
      tag: {
        findMany: vi.fn().mockResolvedValue([{ id: 2 }, { id: 5 }])
      },
      artworkTag: {
        createMany: vi.fn().mockResolvedValue({ count: 2 })
      }
    } as unknown as Prisma.TransactionClient

    await appendArchiveDefaultTags(transaction, 42, [2, 5, 9])

    expect(transaction.tag.findMany).toHaveBeenCalledWith({
      where: { id: { in: [2, 5, 9] } },
      select: { id: true }
    })
    expect(transaction.artworkTag.createMany).toHaveBeenCalledWith({
      data: [
        { artworkId: 42, tagId: 2, provenance: 'MANUAL' },
        { artworkId: 42, tagId: 5, provenance: 'MANUAL' }
      ],
      skipDuplicates: true
    })
  })

  it('does not query or write tags when the frozen selection is empty', async () => {
    const transaction = {
      tag: { findMany: vi.fn() },
      artworkTag: { createMany: vi.fn() }
    } as unknown as Prisma.TransactionClient

    await appendArchiveDefaultTags(transaction, 42, [])

    expect(transaction.tag.findMany).not.toHaveBeenCalled()
    expect(transaction.artworkTag.createMany).not.toHaveBeenCalled()
  })
})
